package services

import (
	"strings"
	"testing"

	"wa-assistant/backend/models"
)

func TestToneInstructionOverridesPersonaStyle(t *testing.T) {
	for _, tone := range []string{"ramah", "formal", "santai", "persuasif"} {
		instruction := toneInstruction(tone)
		if !strings.Contains(instruction, "mengesampingkan gaya bahasa berbeda") {
			t.Errorf("tone %q harus menegaskan prioritas terhadap gaya di persona: %q", tone, instruction)
		}
	}

	if instruction := toneInstruction("custom"); instruction != "" {
		t.Errorf("tone custom harus mengikuti persona tanpa instruksi tambahan, dapat %q", instruction)
	}
}

func TestTokenizeQuery(t *testing.T) {
	got := tokenizeQuery("Berapa harga kaos ini ya kak?")
	// "ini", "kak" = stopword; "ya" < 3 huruf → tersaring. Sisanya kata bermakna.
	want := map[string]bool{"berapa": true, "harga": true, "kaos": true}
	if len(got) != len(want) {
		t.Fatalf("tokenizeQuery = %v, mau 3 token bermakna %v", got, want)
	}
	for _, w := range got {
		if !want[w] {
			t.Errorf("token tak terduga: %q (out=%v)", w, got)
		}
	}
	if tq := tokenizeQuery("ya kak di ke"); len(tq) != 0 {
		t.Errorf("query semua stopword/pendek harus kosong, dapat %v", tq)
	}
	aliases := tokenizeQuery("harganya berapa dan biaya kirimnya?")
	wantAliases := map[string]bool{"harga": true, "berapa": true, "pengiriman": true}
	if len(aliases) != len(wantAliases) {
		t.Fatalf("normalisasi alias = %v", aliases)
	}
	for _, token := range aliases {
		if !wantAliases[token] {
			t.Fatalf("token alias tak terduga: %q", token)
		}
	}
}

func TestKeywordSearch(t *testing.T) {
	items := []KBItem{
		{K: models.Knowledge{ID: 1, Question: "Berapa harga kaos polos?", Answer: "Harga kaos polos 75 ribu.", Tags: "harga,kaos"}},
		{K: models.Knowledge{ID: 2, Question: "Jam operasional?", Answer: "Buka jam 8 sampai 5.", Tags: "jam,operasional"}},
		{K: models.Knowledge{ID: 3, Question: "Cara pengiriman?", Answer: "Kirim via JNE.", Tags: "kirim,ongkir"}},
	}

	got := keywordSearch("harga kaos berapa", items)
	if len(got) == 0 || got[0].ID != 1 {
		t.Fatalf("harusnya knowledge #1 (harga kaos) peringkat teratas, dapat %+v", got)
	}

	// Tidak ada overlap kata bermakna → tidak mengembalikan apa-apa (bukan asal comot).
	if r := keywordSearch("apakah ini bagus", items); len(r) != 0 {
		t.Errorf("query tanpa overlap harus kosong, dapat %d item", len(r))
	}

	// Cocok tag persis tetap terdeteksi.
	if r := keywordSearch("mau tanya jam", items); len(r) == 0 || r[0].ID != 2 {
		t.Errorf("query 'jam' harusnya knowledge #2 teratas, dapat %+v", r)
	}

	// Variasi bahasa tetap harus menemukan topik yang sama saat embedding nonaktif/gagal.
	if r := keywordSearch("biaya kirimnya berapa", items); len(r) == 0 || r[0].ID != 3 {
		t.Errorf("alias biaya kirim harus menemukan knowledge pengiriman, dapat %+v", r)
	}
}

func TestMergeKnowledgeResultsDedupesAnswersAndRespectsLimit(t *testing.T) {
	primary := []models.Knowledge{
		{ID: 1, Answer: "Harga kaos Rp75.000"},
		{ID: 2, Answer: "Pengiriman melalui JNE"},
	}
	secondary := []models.Knowledge{
		{ID: 3, Answer: "Harga kaos Rp75.000"}, // jawaban sama, jangan memenuhi prompt
		{ID: 4, Answer: "Buka pukul delapan"},
		{ID: 5, Answer: "Lokasi di Bandung"},
	}
	got := mergeKnowledgeResults(primary, secondary, 3)
	if len(got) != 3 || got[0].ID != 1 || got[1].ID != 2 || got[2].ID != 4 {
		t.Fatalf("hasil merge tidak sesuai: %+v", got)
	}
}

func TestProductRelevanceScore(t *testing.T) {
	product := models.Product{
		Name:        "Kaos Polos Premium",
		Price:       "Rp 75.000",
		Description: "Cotton combed 24s, warna hitam dan putih.",
	}
	if score := productRelevanceScore(product, tokenizeQuery("harga kaos polos berapa")); score < 10 {
		t.Fatalf("produk relevan harus dapat skor tinggi, dapat %d", score)
	}
	if score := productRelevanceScore(product, tokenizeQuery("jam operasional toko")); score != 0 {
		t.Fatalf("produk tidak relevan harus skor 0, dapat %d", score)
	}
	if !productCatalogIntent(tokenizeQuery("ada katalog produk apa saja")) {
		t.Fatalf("intent katalog produk harus terdeteksi")
	}
	// Hybrid: tanpa keyword, sim tinggi tetap lolos; sim lemah ditolak.
	if productHybridScore(0, 0.50) <= 0 {
		t.Fatal("hybrid harus mengangkat sim >= threshold")
	}
	if productHybridScore(0, 0.10) != 0 {
		t.Fatal("hybrid harus menolak sim sangat rendah")
	}
}

func TestSystemPromptDoesNotAllowUnconfirmedClosingClaims(t *testing.T) {
	prompt := buildSystemPrompt(0, "")
	for _, required := range []string{"SUDAH DICATAT", "kode referensi", "Form AI"} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("system prompt harus memuat aturan %q", required)
		}
	}
	if strings.Contains(prompt, "Begitu nama & produk lengkap, konfirmasikan singkat bahwa pesanan dicatat") {
		t.Fatal("system prompt masih memuat aturan closing lama yang dapat membuat klaim palsu")
	}
}

func TestSystemPromptRequiresHumanCustomerServicePointOfView(t *testing.T) {
	prompt := buildSystemPrompt(0, "")
	for _, required := range []string{"sudut pandang staf bisnis", "data saya", "Gunakan 'saya'", "jangan mengaku sudah mengecek"} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("system prompt harus memuat aturan POV customer service %q", required)
		}
	}
}

func TestSanitizeCustomerFacingReplyRemovesInternalPointOfView(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Informasi tersebut tidak tercantum di data saya ya kak.", "Detail itu belum bisa saya pastikan ya kak."},
		{"Berdasarkan basis pengetahuan saya, layanan itu belum tersedia.", "Berdasarkan informasi resmi, layanan itu belum tersedia."},
		{"Sebagai AI, saya tidak bisa mengeceknya.", "Sebagai staf yang membantu pelanggan, saya tidak bisa mengeceknya."},
	}
	for _, tt := range tests {
		if got := sanitizeCustomerFacingReply(tt.input); got != tt.want {
			t.Errorf("sanitizeCustomerFacingReply(%q) = %q, mau %q", tt.input, got, tt.want)
		}
	}
}

func TestLooksFactualUserMessage(t *testing.T) {
	for _, msg := range []string{"Halo kak", "Pagi min", "Ok siap", "Terima kasih", "Thanks kak"} {
		if looksFactualUserMessage(msg) {
			t.Fatalf("basa-basi tidak boleh faktual: %q", msg)
		}
	}
	for _, msg := range []string{"Berapa harganya?", "Jam buka toko", "Apakah masih stok?", "Saya mau tanya ongkir ke bandung"} {
		if !looksFactualUserMessage(msg) {
			t.Fatalf("pertanyaan faktual tidak dikenali: %q", msg)
		}
	}
	// Isian multi-baris order = bukan pertanyaan fakta (jangan kena grounding fallback).
	orderFill := "Nama Ega\nJogja\n08393938\n2"
	if looksFactualUserMessage(orderFill) {
		t.Fatalf("isian order multi-baris tidak boleh dianggap pertanyaan faktual: %q", orderFill)
	}
	if !looksLikeTransactionalDataReply(orderFill, nil) {
		t.Fatalf("isian order multi-baris harus terdeteksi transactional: %q", orderFill)
	}
	labeled := "Nama lengkap Ega\nAlamat Jogja\nNo hp 083939393\nJumlah 2"
	if !looksLikeTransactionalDataReply(labeled, nil) {
		t.Fatalf("isian berlabel harus transactional: %q", labeled)
	}
	// Progress order qty — kasus production "Kaos laravel saya pesan 2 pcs kak".
	for _, msg := range []string{
		"Kaos laravel saya pesan 2 pcs kak",
		"Ya lanjut pemesan kak",
		"pesan 2 pcs",
	} {
		if looksFactualUserMessage(msg) {
			t.Fatalf("progress order tidak boleh faktual (grounding): %q", msg)
		}
		if !looksLikeOrderProgressMessage(msg) {
			t.Fatalf("harus terdeteksi order progress: %q", msg)
		}
	}
}

func TestPlausiblePriceTimesQty(t *testing.T) {
	src := map[string]bool{"68250": true, "9": true, "75000": true}
	if !isPlausiblePriceTimesQty("136500", src) { // 68250 * 2
		t.Fatal("total 2×harga harus diterima")
	}
	if isPlausiblePriceTimesQty("99999", src) {
		t.Fatal("total yang bukan kelipatan harga tidak boleh lolos")
	}
}

func TestLooksLikeInventedSpecifics(t *testing.T) {
	relevant := []models.Knowledge{
		{Question: "Harga kaos", Answer: "Harga kaos polos Rp75.000"},
	}
	if looksLikeInventedSpecifics("Harga kaos polos Rp75.000 kak", relevant) {
		t.Fatal("angka yang ada di knowledge tidak boleh dianggap dikarang")
	}
	if !looksLikeInventedSpecifics("Harganya Rp99.000 dan diskon 30%", relevant) {
		t.Fatal("angka di luar knowledge harus terdeteksi sebagai klaim dikarang")
	}
}

func TestSafeUngroundedReplyIsCustomerFacing(t *testing.T) {
	reply := safeUngroundedReply()
	if strings.TrimSpace(reply) == "" {
		t.Fatal("jawaban aman tidak boleh kosong")
	}
	lower := strings.ToLower(reply)
	for _, bad := range []string{"knowledge", "basis pengetahuan", "[[escalate]]", "sebagai ai", "sebagai bot"} {
		if strings.Contains(lower, bad) {
			t.Fatalf("jawaban aman memuat istilah internal %q: %s", bad, reply)
		}
	}
}

func TestProductCheckoutAvailable(t *testing.T) {
	if !productCheckoutAvailable("") {
		t.Fatal("konfigurasi kosong harus memakai checkout bawaan")
	}
	if !productCheckoutAvailable(`[{"action":"checkout"}]`) {
		t.Fatal("aksi checkout tidak dikenali")
	}
	if productCheckoutAvailable(`[{"action":"ai"},{"action":"reply"}]`) {
		t.Fatal("produk tanpa aksi checkout dianggap memiliki checkout")
	}
}

// Katalog DeepSeek tidak mengirim field "name", jadi model tak boleh ikut terbuang
// dan urutannya harus jatuh ke ID.
func TestFilterChatModelsTanpaName(t *testing.T) {
	got := filterChatModels([]ChatModelInfo{
		{ID: "deepseek-reasoner"},
		{ID: "deepseek-chat"},
		{ID: "text-embedding-3-small"},
	})
	if len(got) != 2 || got[0].ID != "deepseek-chat" || got[1].ID != "deepseek-reasoner" {
		t.Fatalf("filter model chat DeepSeek = %#v", got)
	}
}

func TestFilterVisionModels(t *testing.T) {
	textOnly := ChatModelInfo{ID: "text-only", Name: "Text"}
	textOnly.Architecture.InputModalities = []string{"text"}
	vision := ChatModelInfo{ID: "vision", Name: "Vision"}
	vision.Architecture.InputModalities = []string{"text", "image"}
	got := filterVisionModels([]ChatModelInfo{textOnly, vision})
	if len(got) != 1 || got[0].ID != "vision" {
		t.Fatalf("filter model vision = %#v", got)
	}
}

func TestBuildRetrievalQuery(t *testing.T) {
	hist := []models.ChatHistory{
		{Message: "Halo", Reply: "Halo kak, ada yang bisa dibantu?"},
		{Message: "Ada kaos warna apa aja?", Reply: "Ada merah, hitam, putih kak."},
	}

	tests := []struct {
		name    string
		msg     string
		history []models.ChatHistory
		want    string
	}{
		{
			name:    "pesan pendek digabung pesan customer sebelumnya",
			msg:     "yang merah berapa?",
			history: hist,
			want:    "Ada kaos warna apa aja? yang merah berapa?",
		},
		{
			name:    "pesan satu kata follow-up",
			msg:     "berapa?",
			history: hist,
			want:    "Ada kaos warna apa aja? berapa?",
		},
		{
			name: "jawaban singkat memakai pertanyaan terakhir asisten",
			msg:  "Masih kak",
			history: []models.ChatHistory{
				{Message: "[Foto]", Reply: "Apakah kipasnya masih berfungsi dengan baik kak?"},
			},
			// [Foto] = anchor lemah; pakai pertanyaan asisten (dipotong max 120 rune bila panjang).
			want: "Pertanyaan terakhir asisten: Apakah kipasnya masih berfungsi dengan baik kak? Jawaban pelanggan: Masih kak",
		},
		{
			name: "intent topik tidak ditimpa katalog bot",
			msg:  "Mau paket premium jakarta",
			history: []models.ChatHistory{
				{Message: "jual apa", Reply: "Kami jual A, B, C, D, E, F. Ada yang ditanyakan?"},
			},
			want: "Mau paket premium jakarta",
		},
		{
			name: "follow-up atribut mewarisi topik dari user",
			msg:  "ada variant apa aja",
			history: []models.ChatHistory{
				{Message: "Mau paket premium jakarta", Reply: "Ada kak, mau dicek lebih lanjut?"},
			},
			want: "Mau paket premium jakarta ada variant apa aja",
		},
		{
			name:    "pesan panjang dipakai apa adanya",
			msg:     "Saya mau pesan kaos warna merah ukuran XL berapa harganya ya kak",
			history: hist,
			want:    "Saya mau pesan kaos warna merah ukuran XL berapa harganya ya kak",
		},
		{
			name:    "pesan pendek tanpa history tetap apa adanya",
			msg:     "berapa?",
			history: nil,
			want:    "berapa?",
		},
		{
			name:    "lebih dari 4 kata dipakai apa adanya",
			msg:     "apakah ini bisa dikirim besok",
			history: hist,
			want:    "apakah ini bisa dikirim besok",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := buildRetrievalQuery(tt.msg, tt.history); got != tt.want {
				t.Errorf("buildRetrievalQuery(%q) = %q, mau %q", tt.msg, got, tt.want)
			}
		})
	}
}
