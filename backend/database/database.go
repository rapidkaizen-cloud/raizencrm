package database

import (
	"fmt"
	"log"
	"os"
	"time"
	"wa-assistant/backend/config"
	"wa-assistant/backend/models"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/mysql"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var DB *gorm.DB

func Init() {
	// Coba MySQL dulu, fallback ke SQLite kalau MySQL tidak tersedia
	host := config.Env("DB_HOST", "localhost")
	port := config.Env("DB_PORT", "3306")
	user := config.Env("DB_USER", "root")
	pass := config.Env("DB_PASS", "")
	name := config.Env("DB_NAME", "wa_assistant")

	var err error

	// Coba MySQL
	if host != "" && host != "sqlite" {
		if !validDBName(name) {
			log.Printf("DB_NAME tidak valid (%q) — pakai default 'wa_assistant'", name)
			name = "wa_assistant"
		}

		rootDSN := fmt.Sprintf("%s:%s@tcp(%s:%s)/?charset=utf8mb4&parseTime=True&loc=Local", user, pass, host, port)
		if rootDB, rootErr := gorm.Open(mysql.Open(rootDSN), &gorm.Config{}); rootErr == nil {
			rootDB.Exec("CREATE DATABASE IF NOT EXISTS `" + name + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
			if sqlDB, e := rootDB.DB(); e == nil {
				sqlDB.Close()
			}
		}

		dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local", user, pass, host, port, name)
		DB, err = gorm.Open(mysql.Open(dsn), &gorm.Config{})
		if err == nil {
			log.Println("Database: MySQL connected")
			if sqlDB, e := DB.DB(); e == nil {
				sqlDB.SetMaxOpenConns(config.EnvInt("DB_MAX_OPEN_CONNS", 25))
				sqlDB.SetMaxIdleConns(config.EnvInt("DB_MAX_IDLE_CONNS", 5))
				sqlDB.SetConnMaxLifetime(time.Duration(config.EnvInt("DB_CONN_MAX_LIFETIME_MIN", 30)) * time.Minute)
			}
		}
	}

	// Fallback ke SQLite
	if DB == nil || err != nil {
		if err != nil {
			log.Printf("MySQL unavailable (%v) — fallback ke SQLite", err)
		}
		dbPath := config.Env("DB_PATH", "./wa-assistant.db")
		// Driver "sqlite" = modernc.org/sqlite (pure Go, sudah dipakai untuk sesi whatsmeow).
		// Default gorm.io/driver/sqlite memakai mattn/go-sqlite3 yang butuh CGO.
		dsn := dbPath + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
		DB, err = gorm.Open(sqlite.New(sqlite.Config{DriverName: "sqlite", DSN: dsn}), &gorm.Config{})
		if err != nil {
			log.Fatal("Database error (SQLite): ", err)
		}
		log.Printf("Database: SQLite connected (%s)", dbPath)
	}

	DB.AutoMigrate(
		&models.User{}, &models.LoginThrottle{}, &models.Agent{}, &models.ChatHistory{}, &models.Setting{},
		&models.AITurn{},
		&models.Knowledge{}, &models.Handoff{}, &models.Contact{}, &models.ConversationMemory{},
		&models.CrawlJob{}, &models.CrawlPage{},
		&models.Tenant{},
		&models.Broadcast{}, &models.BroadcastRecipient{}, &models.OptOut{}, &models.ContactConsent{},
		&models.ScheduledMessage{}, &models.ScheduledStatus{}, &models.Label{}, &models.ChatLabel{}, &models.AutoReply{},
		&models.Flow{}, &models.FlowSession{}, &models.OTPCode{},
		&models.Template{},
		&models.FollowUp{}, &models.FollowUpStep{}, &models.FollowUpEnrollment{},
		&models.Product{}, &models.ProductCheckoutSession{}, &models.ProductOrder{},
		&models.AIForm{}, &models.AIFormSession{}, &models.AIFormSubmission{},
		&models.AppSetting{},
		&models.ClosingForm{}, &models.ClosingRecord{},
		&models.ShippingCity{},
		&models.ShippingOrder{},
		&models.MediaAsset{},
		&models.GroupGuardConfig{}, &models.GroupModerationLog{},
		&models.MetaConversionEvent{},
	)

	backfillKnowledgeCharCount()
	recoverStuckCrawlJobs()
	seedSuperAdmin()
	seedDefaultTenant()

	log.Println("Database ready")
}

// validDBName memastikan nama database hanya berisi huruf/angka/underscore
// (mencegah injeksi pada query CREATE DATABASE yang merangkai nama).
func validDBName(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		ok := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_'
		if !ok {
			return false
		}
	}
	return true
}

// backfillKnowledgeCharCount mengisi char_count knowledge lama (kolom baru) = panjang Answer,
// agar perhitungan kuota karakter akurat. DB-agnostic, hanya menyentuh baris yang masih 0.
func backfillKnowledgeCharCount() {
	var rows []models.Knowledge
	DB.Where("char_count = 0 AND answer <> ''").Find(&rows)
	for i := range rows {
		DB.Model(&models.Knowledge{}).Where("id = ?", rows[i].ID).
			Update("char_count", len([]rune(rows[i].Answer)))
	}
	if len(rows) > 0 {
		log.Printf("Backfill char_count untuk %d knowledge lama", len(rows))
	}
}

// recoverStuckCrawlJobs membereskan job yang menggantung saat server restart di tengah proses.
// Goroutine crawl/training mati saat restart, jadi statusnya tak akan pernah berubah sendiri:
// crawl yang belum kelar -> failed; training yang belum kelar -> done (halaman yang sudah jadi tetap aman).
func recoverStuckCrawlJobs() {
	c := DB.Model(&models.CrawlJob{}).Where("status IN ?", []string{"pending", "crawling"}).
		Updates(map[string]any{"status": "failed", "error": "terhenti karena server restart"})
	t := DB.Model(&models.CrawlJob{}).Where("status IN ?", []string{"training", "stopping"}).
		Update("status", "done")
	// Halaman yang sempat berstatus "training" saat restart -> kembalikan ke "crawled" agar bisa dilatih ulang.
	DB.Model(&models.CrawlPage{}).Where("status = ?", "training").Update("status", "crawled")
	if c.RowsAffected > 0 || t.RowsAffected > 0 {
		log.Printf("Recover crawl job menggantung: %d crawl -> failed, %d training -> done", c.RowsAffected, t.RowsAffected)
	}
}

// seedSuperAdmin memastikan ada satu operator platform (login ke /admin).
func seedSuperAdmin() {
	var n int64
	DB.Model(&models.User{}).Where("is_super_admin = ?", true).Count(&n)
	if n > 0 {
		syncSuperAdminPassword() // jaga password/username super-admin sinkron dengan env
		return
	}
	username := config.Env("SUPERADMIN_USERNAME", "superadmin")
	pw := os.Getenv("SUPERADMIN_PASSWORD")
	if pw == "" {
		log.Println("Seeder: SUPERADMIN_PASSWORD tidak diset — skip superadmin")
		return
	}
	// Tolak password lemah agar tidak ada instalasi produksi dengan kredensial mudah ditebak.
	if len(pw) < 12 {
		log.Println("Seeder: SUPERADMIN_PASSWORD terlalu pendek (min 12 karakter) — superadmin TIDAK dibuat")
		return
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	DB.Create(&models.User{
		Name: "Super Admin", Username: username, Email: "super@wa-assistant.local",
		Password: string(hash), IsSuperAdmin: true, Role: "admin",
	})
	log.Printf("Seeder: super admin '%s' dibuat", username)
}

// syncSuperAdminPassword memperbarui kredensial super-admin agar cocok dengan env
// SUPERADMIN_PASSWORD / SUPERADMIN_USERNAME (kalau diisi). Cara aman ganti password
// super-admin TANPA lewat chat: set SUPERADMIN_PASSWORD di .env lalu restart service.
// Kalau env kosong, kredensial yang ada dibiarkan apa adanya.
func syncSuperAdminPassword() {
	pw := os.Getenv("SUPERADMIN_PASSWORD")
	if pw == "" {
		return
	}
	username := config.Env("SUPERADMIN_USERNAME", "superadmin")
	var u models.User
	if DB.Where("is_super_admin = ?", true).First(&u).Error != nil {
		return
	}
	// Sudah cocok → cukup pastikan username sinkron.
	// Password TIDAK di-overwrite — user bisa ganti dari dashboard.
	if bcrypt.CompareHashAndPassword([]byte(u.Password), []byte(pw)) == nil {
		if u.Username != username {
			DB.Model(&u).Update("username", username)
		}
		return
	}
	// Password di DB beda dengan .env → user sudah ganti via dashboard. Hormati perubahan user.
	log.Printf("Super admin '%s': password di DB berbeda dari .env (user sudah ganti via dashboard)", username)
}

// seedDefaultTenant memastikan tenant ID=1 selalu ada + punya minimal 1 agent.
func seedDefaultTenant() {
	// Pastikan tenant ID 1 ada.
	var t models.Tenant
	if DB.First(&t, uint(1)).Error != nil {
		t = models.Tenant{Name: "Default"}
		t.ID = 1
		DB.Create(&t)
		log.Printf("Seeder: tenant default (id=1) dibuat")
	}

	// Pastikan tenant 1 punya minimal 1 agent.
	var agentCount int64
	DB.Model(&models.Agent{}).Where("tenant_id = 1").Count(&agentCount)
	if agentCount == 0 {
		def := models.Agent{TenantID: 1, Name: "CS Utama", Tone: "ramah"}
		DB.Create(&def)
		DB.Model(&models.Knowledge{}).Where("agent_id = 0 OR agent_id IS NULL").Update("agent_id", def.ID)
		DB.Model(&models.ChatHistory{}).Where("agent_id = 0 OR agent_id IS NULL").Update("agent_id", def.ID)
		log.Printf("Seeder: agent default 'CS Utama' dibuat untuk tenant 1")
	}

	// Pindahkan data yatim ke tenant 1.
	DB.Model(&models.Agent{}).Where("tenant_id = 0 OR tenant_id IS NULL").Update("tenant_id", 1)
	DB.Model(&models.Knowledge{}).Where("agent_id = 0 OR agent_id IS NULL").Update("agent_id", 1)
	DB.Model(&models.ChatHistory{}).Where("agent_id = 0 OR agent_id IS NULL").Update("agent_id", 1)
}
