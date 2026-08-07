// SlaluDiskon — WhatsApp AI & Blast.
// © 2026 slaludiskon.com. All rights reserved.

package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	"wa-assistant/backend/config"
	"wa-assistant/backend/database"
	"wa-assistant/backend/handlers"
	"wa-assistant/backend/license"
	"wa-assistant/backend/services"
	"wa-assistant/backend/ui"

	"github.com/gin-gonic/gin"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "license-reset" {
		if err := license.Reset(); err != nil {
			log.Fatalf("Reset lisensi gagal: %v", err)
		}
		log.Println("Lisensi berhasil di-reset. Jalankan aplikasi kembali untuk aktivasi di mesin ini.")
		return
	}

	database.Init()
	handlers.ConsolidateAllKnowledge()

	// Verifikasi lisensi saat startup.
	if !license.Verify() {
		ui.LicenseError(license.VerifyMessage)
	}
	appCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	// A terminal license decision or expired offline grace triggers the same
	// graceful shutdown path as SIGTERM.
	license.StartHeartbeat(appCtx, 6*time.Hour, 12*time.Hour, func(message string) {
		log.Printf("Shutdown karena lisensi: %s", message)
		stop()
	})

	services.InitAI()
	services.InitEmbedding()

	services.Go("BackfillEmbeddings", services.BackfillEmbeddings)
	services.InitWA(config.Env("DB_PATH", "./wa-assistant.db"))
	services.SetHandlers(handlers.OnWAMessage, handlers.OnDeviceLinked)
	services.SetOutgoingMessageHandler(handlers.OnWAOwnMessage)
	services.SetLabelHandlers(handlers.OnLabelEdit, handlers.OnLabelAssoc)
	services.SetConnectedHandler(handlers.OnAgentConnected)
	services.SetReceiptHandler(handlers.OnWAReceipt)
	handlers.InitGroupGuard()

	// Sambungkan ulang semua agent yang sudah ter-link.
	services.Go("StartAgents", handlers.StartAgents)
	services.StartReconnectWatchdogCtx(appCtx, 90*time.Second)
	// Gabungkan pengirim yang terlanjur tercatat sebagai LID ke nomor telepon aslinya.
	handlers.StartLIDSweeperCtx(appCtx)

	// Lanjutkan broadcast yang sempat terhenti saat server mati; tandai jadwal yang nyangkut.
	services.Go("ResumeBroadcasts", handlers.ResumeBroadcasts)
	handlers.CleanupStuckSchedules()

	// Seed daftar kota RajaOngkir ke DB lokal (async, non-blocking).
	services.Go("SeedShippingCities", services.SeedShippingCities)

	// Scheduler pesan terjadwal + pembersihan media lama.
	handlers.StartSchedulerCtx(appCtx)
	handlers.StartMediaCleanup(config.EnvInt("MEDIA_RETENTION_DAYS", 30))
	// Retry pesan WhatsApp yang gagal terkirim.
	handlers.StartFailedSendRetry(appCtx)
	// Tracking sinkronisasi otomatis pesanan pengiriman (Mengantar).
	handlers.StartShippingTrackingSync()
	// Meta CAPI tidak digunakan — instalasi internal.

	// Bersihkan entry throttle login yang kadaluarsa secara berkala.
	handlers.StartLoginThrottleSweeper()

	r := gin.Default()
	maxRequestMB := config.EnvInt("MAX_REQUEST_MB", 32)
	r.MaxMultipartMemory = int64(config.EnvInt("MAX_MULTIPART_MEMORY_MB", 16)) << 20
	r.Use(handlers.BodySizeLimit(int64(maxRequestMB)<<20), handlers.CORS())

	api := r.Group("/api")
	{
		api.POST("/login", handlers.Login)
		api.GET("/verify-email", handlers.VerifyEmail)
		api.POST("/resend-verification", handlers.ResendVerification)
		api.POST("/forgot-password", handlers.ForgotPassword)
		api.POST("/reset-password", handlers.ResetPassword)
		api.GET("/agents/:id/media/:cid", handlers.ServeMedia)
		api.GET("/agents/:id/products/:pid/image", handlers.ServeProductImage)
		api.GET("/me", handlers.AuthMiddleware(), handlers.Me)
		api.PUT("/profile", handlers.AuthMiddleware(), handlers.UpdateProfile)
		api.PUT("/change-password", handlers.AuthMiddleware(), handlers.ChangePassword)

		// REST API publik (autentikasi API key per-nomor) untuk integrasi eksternal.
		v1 := api.Group("/v1", handlers.APIKeyMiddleware())
		{
			v1.POST("/messages", handlers.APISendMessage)
			v1.GET("/messages/:message_id/media", handlers.APIServeMessageMedia)
			v1.GET("/messages/:message_id/analysis", handlers.APIMessageAnalysis)
			v1.POST("/otp/request", handlers.APIRequestOTP)
			v1.POST("/otp/verify", handlers.APIVerifyOTP)
			v1.POST("/check", handlers.APICheckNumber)
			v1.GET("/status", handlers.APIStatus)
			v1.GET("/contacts", handlers.APIListContacts)
			v1.POST("/contacts", handlers.APISaveContact)
			v1.GET("/contacts/:number", handlers.APIGetContact)
			v1.PUT("/contacts/:number", handlers.APIUpdateContact)
			v1.DELETE("/contacts/:number", handlers.APIDeleteContact)
			v1.GET("/groups", handlers.APIListGroups)
			v1.POST("/groups/:jid/messages", handlers.APIGroupSendMessage)
			v1.GET("/chats", handlers.APIListChats)
			v1.GET("/chats/:number/messages", handlers.APIChatMessages)
			v1.GET("/media/:cid", handlers.APIServeMedia)
			v1.POST("/broadcasts", handlers.APICreateBroadcast)
			v1.GET("/broadcasts", handlers.APIListBroadcasts)
			v1.GET("/broadcasts/:id", handlers.APIBroadcastStatus)
			v1.GET("/broadcasts/:id/recipients", handlers.APIBroadcastRecipients)
			v1.POST("/broadcasts/:id/cancel", handlers.APICancelBroadcast)
		}
		api.GET("/settings/api-config", handlers.AuthMiddleware(), handlers.GetAPIConfig)
		api.PUT("/settings/api-config", handlers.AuthMiddleware(), handlers.RequireSuperAdmin(), handlers.SaveAPIConfig)
		api.GET("/settings/embedding-models", handlers.AuthMiddleware(), handlers.RequireSuperAdmin(), handlers.ListEmbeddingModels)
		api.GET("/settings/chat-models", handlers.AuthMiddleware(), handlers.RequireSuperAdmin(), handlers.ListChatModels)
		api.GET("/settings/vision-models", handlers.AuthMiddleware(), handlers.RequireSuperAdmin(), handlers.ListVisionModels)

		// Shipping public (search address tidak perlu auth)
		api.GET("/shipping/search-address", handlers.SearchMengantarAddress)
		api.GET("/shipping/addresses", handlers.AuthMiddleware(), handlers.GetMengantarAddresses)

		auth := api.Group("", handlers.AuthMiddleware())
		{
			// Endpoint lama (back-compat) -> beroperasi pada agent default (id 1).
			auth.GET("/wa/status", handlers.GetNumberStatus)
			auth.POST("/wa/connect", handlers.ConnectNumber)
			auth.POST("/wa/logout", handlers.LogoutNumber)
			auth.GET("/handoffs", handlers.ListHandoffs)
			auth.DELETE("/handoffs/:sender", handlers.ResumeHandoff)
			auth.GET("/chat-history", handlers.ChatHistory)
			auth.GET("/settings", handlers.GetSettings)
			auth.PUT("/settings", handlers.UpdateSettings)
			auth.GET("/knowledge", handlers.ListKnowledge)
			auth.POST("/knowledge", handlers.CreateKnowledge)
			auth.POST("/knowledge/generate", handlers.GenerateKnowledge)
			auth.POST("/knowledge/import", handlers.ImportKnowledge)
			auth.PUT("/knowledge/:kid", handlers.UpdateKnowledge)
			auth.DELETE("/knowledge/:kid", handlers.DeleteKnowledge)

			// Multi-agent (CS).
			auth.GET("/agents", handlers.ListAgents)
			auth.GET("/agents-status", handlers.AgentStatuses)
			auth.POST("/agents", handlers.CreateAgent)
			auth.PUT("/agents/:id", handlers.UpdateAgent)
			auth.DELETE("/agents/:id", handlers.DeleteAgent)
			auth.GET("/agents/:id/wa/status", handlers.GetNumberStatus)
			auth.POST("/agents/:id/wa/connect", handlers.ConnectNumber)
			auth.POST("/agents/:id/wa/connect-pairing", handlers.ConnectPairingNumber)
			auth.POST("/agents/:id/wa/logout", handlers.LogoutNumber)
			// REST API & webhook per-nomor (kelola key/URL dari dashboard).
			auth.GET("/agents/:id/api", handlers.GetAPISettings)
			auth.POST("/agents/:id/api/key", handlers.RotateAPIKey)
			auth.DELETE("/agents/:id/api/key", handlers.RevokeAPIKey)
			auth.PUT("/agents/:id/api/webhook", handlers.SaveWebhook)
			auth.POST("/agents/:id/api/webhook-secret", handlers.RotateWebhookSecret)
			auth.POST("/agents/:id/api/webhook/test", handlers.TestWebhook)
			auth.POST("/agents/:id/api/test-message", handlers.TestAPIMessage)
			auth.GET("/agents/:id/handoffs", handlers.ListHandoffs)
			auth.DELETE("/agents/:id/handoffs/:sender", handlers.ResumeHandoff)
			auth.GET("/agents/:id/chat-history", handlers.ChatHistory)
			auth.GET("/agents/:id/settings", handlers.GetSettings)
			auth.PUT("/agents/:id/settings", handlers.UpdateSettings)
			auth.POST("/agents/:id/setup-wizard", handlers.SetupWizard)
			auth.GET("/agents/:id/knowledge", handlers.ListKnowledge)
			auth.POST("/agents/:id/knowledge", handlers.CreateKnowledge)
			auth.POST("/agents/:id/knowledge/generate", handlers.GenerateKnowledge)
			auth.POST("/agents/:id/knowledge/import", handlers.ImportKnowledge)
			auth.PUT("/agents/:id/knowledge/:kid", handlers.UpdateKnowledge)
			auth.DELETE("/agents/:id/knowledge-all", handlers.DeleteAllKnowledge)
			auth.DELETE("/agents/:id/knowledge/:kid", handlers.DeleteKnowledge)

			// Latih AI dari website: crawl (background) -> pilih halaman -> embed jadi knowledge.
			auth.POST("/agents/:id/crawl", handlers.StartCrawl)
			auth.GET("/agents/:id/crawl", handlers.LatestCrawl)
			auth.GET("/agents/:id/crawl/:jobId", handlers.CrawlStatus)
			auth.POST("/agents/:id/crawl/:jobId/train", handlers.TrainCrawlPages)
			auth.POST("/agents/:id/crawl/:jobId/train/stop", handlers.StopTraining)
			auth.GET("/agents/:id/knowledge-usage", handlers.KnowledgeUsage)
			auth.POST("/agents/:id/persona/regenerate", handlers.RegeneratePersona)

			// Fitur jualan: simulator, analitik, inbox.
			auth.POST("/agents/:id/test-chat", handlers.TestChat)
			auth.GET("/agents/:id/analytics", handlers.AgentAnalytics)
			auth.GET("/agents/:id/ai-metrics", handlers.AgentAIMetrics)
			auth.GET("/agents/:id/contacts", handlers.InboxContacts)
			auth.GET("/agents/:id/conversation", handlers.InboxConversation)
			auth.DELETE("/agents/:id/conversation", handlers.DeleteInboxConversation)
			auth.GET("/agents/:id/conversation/brief", handlers.GetConversationBrief)
			auth.POST("/agents/:id/conversation/brief", handlers.RefreshConversationBrief)
			auth.POST("/agents/:id/send", handlers.InboxSend)
			auth.POST("/agents/:id/send-media", handlers.InboxSendMedia)
			auth.POST("/agents/:id/messages/:cid/analyze", handlers.ReanalyzeInboxImage)
			auth.POST("/agents/:id/typing", handlers.ChatPresence)
			auth.DELETE("/agents/:id/messages/:msgId", handlers.RevokeMessage)
			auth.GET("/agents/:id/auto-replies", handlers.ListAutoReplies)
			auth.POST("/agents/:id/auto-replies", handlers.CreateAutoReply)
			auth.PUT("/agents/:id/auto-replies/:rid", handlers.UpdateAutoReply)
			auth.DELETE("/agents/:id/auto-replies/:rid", handlers.DeleteAutoReply)
			auth.GET("/agents/:id/flow", handlers.GetFlow)
			auth.POST("/agents/:id/flow", handlers.SaveFlow)
			auth.GET("/agents/:id/templates", handlers.ListTemplates)
			auth.POST("/agents/:id/templates", handlers.CreateTemplate)
			auth.PUT("/agents/:id/templates/:tid", handlers.UpdateTemplate)
			auth.DELETE("/agents/:id/templates/:tid", handlers.DeleteTemplate)
			auth.GET("/agents/:id/crm/contacts", handlers.ListSavedContacts)
			auth.POST("/agents/:id/crm/contacts", handlers.CreateSavedContact)
			auth.PUT("/agents/:id/crm/contacts/:cid", handlers.UpdateSavedContact)
			auth.DELETE("/agents/:id/crm/contacts/:cid", handlers.DeleteSavedContact)
			auth.POST("/agents/:id/crm/contacts/bulk-tag", handlers.BulkTagSavedContacts)
			auth.POST("/agents/:id/crm/contacts/bulk-stage", handlers.BulkStageSavedContacts)
			auth.POST("/agents/:id/crm/contacts/import", handlers.ImportSavedContacts)
			auth.POST("/agents/:id/crm/contacts/bulk-delete", handlers.BulkDeleteSavedContacts)
			auth.GET("/agents/:id/follow-ups", handlers.ListFollowUps)
			auth.POST("/agents/:id/follow-ups", handlers.CreateFollowUp)
			auth.PUT("/agents/:id/follow-ups/:fid", handlers.UpdateFollowUp)
			auth.DELETE("/agents/:id/follow-ups/:fid", handlers.DeleteFollowUp)
			auth.POST("/agents/:id/follow-ups/:fid/enroll", handlers.EnrollFollowUp)

			// Katalog produk.
			auth.GET("/agents/:id/products", handlers.ListProducts)
			auth.POST("/agents/:id/products", handlers.CreateProduct)
			auth.POST("/agents/:id/products/generate-ai", handlers.GenerateProductAIContent)
			auth.PUT("/agents/:id/products/:pid", handlers.UpdateProduct)
			auth.DELETE("/agents/:id/products/:pid", handlers.DeleteProduct)
			auth.POST("/agents/:id/products/:pid/send", handlers.SendProduct)
			auth.GET("/agents/:id/product-orders", handlers.ListProductOrders)
			auth.GET("/agents/:id/ai-forms", handlers.ListAIForms)
			auth.POST("/agents/:id/ai-forms", handlers.CreateAIForm)
			auth.PUT("/agents/:id/ai-forms/:fid", handlers.UpdateAIForm)
			auth.DELETE("/agents/:id/ai-forms/:fid", handlers.DeleteAIForm)
			auth.GET("/agents/:id/ai-form-submissions", handlers.ListAIFormSubmissions)
			auth.GET("/agents/:id/broadcast/consent-summary", handlers.BroadcastConsentSummary)
			auth.POST("/agents/:id/broadcast", handlers.CreateBroadcast)
			auth.POST("/agents/:id/broadcast/rotation-test", handlers.TestBroadcastRotation)
			auth.GET("/agents/:id/broadcasts", handlers.ListBroadcasts)
			auth.GET("/agents/:id/broadcasts/:bid", handlers.BroadcastDetail)
			auth.POST("/agents/:id/broadcasts/:bid/cancel", handlers.CancelBroadcast)
			auth.POST("/agents/:id/broadcasts/:bid/resume", handlers.ResumeBroadcast)
			auth.GET("/agents/:id/chat-contacts", handlers.ChatContacts)
			auth.GET("/agents/:id/wa-contacts", handlers.WAContacts)
			auth.POST("/agents/:id/check-numbers", handlers.CheckNumbersOnWA)
			auth.GET("/agents/:id/groups", handlers.Groups)
			auth.GET("/agents/:id/group-members", handlers.GroupMembers)
			auth.GET("/agents/:id/group-config", handlers.GroupConfig)
			auth.PUT("/agents/:id/group-config", handlers.SaveGroupConfig)
			auth.GET("/agents/:id/group-moderation", handlers.GroupModeration)
			auth.POST("/agents/:id/group-moderation/:logid/confirm-kick", handlers.ConfirmKick)
			auth.POST("/agents/:id/group-moderation/:logid/dismiss", handlers.DismissModeration)
			auth.GET("/agents/:id/labels", handlers.Labels)
			auth.POST("/agents/:id/labels/sync", handlers.SyncLabels)
			auth.GET("/agents/:id/label-contacts", handlers.LabelContacts)
			auth.POST("/agents/:id/schedule", handlers.CreateSchedule)
			auth.GET("/agents/:id/schedules", handlers.ListSchedules)
			auth.DELETE("/agents/:id/schedule/:sid", handlers.CancelSchedule)
			auth.POST("/agents/:id/status", handlers.CreateStatus)
			auth.GET("/agents/:id/statuses", handlers.ListStatuses)
			auth.DELETE("/agents/:id/status/:sid", handlers.CancelStatus)

			// --- Shipping / Ongkir (Mengantar API) ---
			auth.GET("/agents/:id/shipping/estimate", handlers.CheckShipping)
			auth.GET("/agents/:id/shipping/orders", handlers.GetShippingOrders)
			auth.GET("/agents/:id/shipping/orders/:orderId", handlers.GetShippingOrderDetail)
			auth.POST("/agents/:id/shipping/orders", handlers.CreateShippingOrder)
			auth.POST("/agents/:id/shipping/sync-tracking", handlers.SyncShippingTracking)

			// --- Media Assets (untuk AI auto-send media) ---
			auth.GET("/agents/:id/media-assets", handlers.ListMediaAssets)
			auth.POST("/agents/:id/media-assets", handlers.UploadMediaAsset)
			auth.DELETE("/agents/:id/media-assets/:assetId", handlers.DeleteMediaAsset)
		}
	}

	port := config.Env("PORT", "3030")
	srv := &http.Server{Addr: ":" + port, Handler: r}
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()
	ui.StartupOK(port)

	<-appCtx.Done()
	log.Println("Mematikan server (graceful)…")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown gagal: %v", err)
	}
	log.Println("Server berhenti.")
}
