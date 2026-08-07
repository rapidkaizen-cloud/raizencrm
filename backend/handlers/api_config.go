package handlers

import (
	"log"
	"strings"

	"wa-assistant/backend/database"
	"wa-assistant/backend/models"
	"wa-assistant/backend/services"

	"github.com/gin-gonic/gin"
)

// apiConfigKeys = semua key AppSetting yang dipakai untuk konfigurasi API.
var apiConfigKeys = []string{
	"api_key", "api_model", "vision_model", "embedding_model",
	"deepseek_api_key", "deepseek_model", "chat_provider",
}

// sensitiveAPIKeys = key yang disimpan terenkripsi at-rest & disamarkan saat ditampilkan.
var sensitiveAPIKeys = map[string]bool{
	"api_key":          true,
	"deepseek_api_key": true,
}

// GetAPIConfig mengembalikan seluruh konfigurasi API (key sensitif disamarkan sebagian).
func GetAPIConfig(c *gin.Context) {
	out := map[string]string{}
	for _, k := range apiConfigKeys {
		var s models.AppSetting
		if database.DB.First(&s, "`key` = ?", k).Error == nil {
			out[k] = maskIfKey(k, decodeSetting(k, s.Value))
		} else {
			out[k] = ""
		}
	}
	c.JSON(200, out)
}

// SaveAPIConfig menyimpan konfigurasi API. Nilai kosong = tidak diubah.
func SaveAPIConfig(c *gin.Context) {
	var req map[string]string
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "Format tidak valid"})
		return
	}
	for _, k := range apiConfigKeys {
		if v, ok := req[k]; ok && strings.TrimSpace(v) != "" {
			// Nilai tersamar yang dikirim kembali UI bukan key baru.
			if sensitiveAPIKeys[k] && strings.Contains(v, "*") {
				continue
			}
			stored := v
			if sensitiveAPIKeys[k] {
				enc, err := services.EncryptSecret(v)
				if err != nil {
					log.Printf("SaveAPIConfig gagal enkripsi %s: %v", k, err)
					c.JSON(500, gin.H{"error": "Gagal menyimpan konfigurasi"})
					return
				}
				stored = enc
			}
			database.DB.Save(&models.AppSetting{Key: k, Value: stored})
		}
	}
	// Terapkan model/key baru saat itu juga. Perubahan model embedding otomatis
	// mengindeks ulang knowledge yang signature modelnya berbeda.
	services.InitAI()
	services.InitEmbedding()
	services.Go("ReindexKnowledgeAfterAPIConfig", services.BackfillEmbeddings)
	c.JSON(200, gin.H{"message": "Konfigurasi API disimpan"})
}

// ListEmbeddingModels mengembalikan katalog model embedding terbaru dari OpenRouter.
func ListEmbeddingModels(c *gin.Context) {
	models, err := services.ListOpenRouterEmbeddingModels(c.Request.Context())
	if err != nil {
		c.JSON(502, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"data": models})
}

// ListChatModels mengembalikan katalog model chat dari provider chat yang aktif
// (DeepSeek Direct atau OpenRouter) untuk pilihan di dashboard.
func ListChatModels(c *gin.Context) {
	models, err := services.ListChatModelsForProvider(c.Request.Context(), c.Query("provider"))
	if err != nil {
		c.JSON(502, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"data": models})
}

func ListVisionModels(c *gin.Context) {
	models, err := services.ListOpenRouterVisionModels(c.Request.Context())
	if err != nil {
		c.JSON(502, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"data": models})
}

// GetAPIConfigRaw = sama seperti GetAPIConfig tapi key TIDAK disamarkan & sudah didekripsi
// (dipakai internal service, bukan API publik).
func GetAPIConfigRaw() map[string]string {
	out := map[string]string{}
	for _, k := range apiConfigKeys {
		var s models.AppSetting
		if database.DB.First(&s, "`key` = ?", k).Error == nil {
			out[k] = decodeSetting(k, s.Value)
		}
	}
	return out
}

// decodeSetting mendekripsi nilai untuk key sensitif; key lain dikembalikan apa adanya.
func decodeSetting(key, value string) string {
	if !sensitiveAPIKeys[key] {
		return value
	}
	plain, err := services.DecryptSecret(value)
	if err != nil {
		log.Printf("decodeSetting gagal dekripsi %s: %v", key, err)
		return ""
	}
	return plain
}

func maskIfKey(key, value string) string {
	if value == "" {
		return ""
	}
	// Hanya sembunyikan key yang sensitif
	if sensitiveAPIKeys[key] {
		if len(value) <= 8 {
			return "***"
		}
		return value[:4] + "****" + value[len(value)-4:]
	}
	return value
}
