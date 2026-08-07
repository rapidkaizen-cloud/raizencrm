package handlers

import (
	"context"
	"log"
	"time"

	"wa-assistant/backend/database"
	"wa-assistant/backend/models"
	"wa-assistant/backend/services"
)

// lidSweepInterval = seberapa sering data LID yang nyangkut dirapikan ulang.
const lidSweepInterval = 15 * time.Minute

// StartLIDSweeperCtx merapikan pengirim LID secara berkala, bukan hanya saat agent
// tersambung. Pemetaan LID->PN sering baru tersedia SETELAH pesan pertama kontak baru
// diproses, jadi pesan itu bisa terlanjur tercatat atas nama LID. Sapuan berkala
// menggabungkannya ke nomor telepon asli begitu pemetaannya muncul.
func StartLIDSweeperCtx(ctx context.Context) {
	sweep := func() {
		var agents []models.Agent
		if err := database.DB.Select("id").Find(&agents).Error; err != nil {
			log.Printf("Sapuan LID: gagal mengambil daftar agent: %v", err)
			return
		}
		for _, a := range agents {
			if services.WA(a.ID).IsConnected() {
				migrateLIDSenders(a.ID)
			}
		}
	}
	go func() {
		t := time.NewTicker(lidSweepInterval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				log.Println("Sapuan LID berhenti")
				return
			case <-t.C:
				safeRun("sweepLIDSenders", sweep)
			}
		}
	}()
}

// migrateLIDSenders merapikan data lama: pengirim yang tersimpan sebagai LID diubah
// jadi nomor telepon asli (pakai pemetaan LID->PN milik whatsmeow). Idempoten —
// setelah semua terkonversi, panggilan berikutnya tidak menemukan kandidat lagi.
// Dipanggil saat agent tersambung (store & pemetaan LID sudah siap).
func migrateLIDSenders(agentID uint) {
	wa := services.WA(agentID)

	candidates := map[string]bool{}
	addDistinct := func(model interface{}, col string) {
		var vals []string
		database.DB.Model(model).Where("agent_id = ? AND "+col+" <> ''", agentID).Distinct().Pluck(col, &vals)
		for _, v := range vals {
			candidates[v] = true
		}
	}
	addDistinct(&models.ChatHistory{}, "sender")
	addDistinct(&models.Handoff{}, "sender")
	addDistinct(&models.OptOut{}, "sender")
	addDistinct(&models.Contact{}, "number")

	mapping := map[string]string{}
	for v := range candidates {
		if pn := wa.PNForLID(v); pn != "" && pn != v {
			mapping[v] = pn
		}
	}
	if len(mapping) == 0 {
		return
	}

	for lid, pn := range mapping {
		// Riwayat chat: SELALU ubah, jangan hapus — itu pesan asli (tak ada batasan unik).
		database.DB.Model(&models.ChatHistory{}).Where("agent_id = ? AND sender = ?", agentID, lid).Update("sender", pn)
		// Tabel status: gabungkan bila baris nomor telepon sudah ada (hindari bentrok unik).
		mergeLIDState(&models.Handoff{}, "sender", agentID, lid, pn)
		mergeLIDState(&models.OptOut{}, "sender", agentID, lid, pn)
		mergeLIDState(&models.Contact{}, "number", agentID, lid, pn)
	}
	log.Printf("Rapikan LID (agent %d): %d pengirim LID diubah ke nomor telepon", agentID, len(mapping))
}

// mergeLIDState mengubah nilai LID jadi nomor telepon pada tabel berstatus tunggal;
// kalau baris untuk nomor telepon itu sudah ada, baris LID dihapus (digabung).
func mergeLIDState(model interface{}, col string, agentID uint, lid, pn string) {
	var existing int64
	database.DB.Model(model).Where("agent_id = ? AND "+col+" = ?", agentID, pn).Limit(1).Count(&existing)
	if existing > 0 {
		database.DB.Where("agent_id = ? AND "+col+" = ?", agentID, lid).Delete(model)
		return
	}
	database.DB.Model(model).Where("agent_id = ? AND "+col+" = ?", agentID, lid).Update(col, pn)
}
