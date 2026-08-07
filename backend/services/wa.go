package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"wa-assistant/backend/database"
	"wa-assistant/backend/models"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/appstate"
	waBinary "go.mau.fi/whatsmeow/binary"
	waProto "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"

	// Driver SQLite pure-Go; init-nya mendaftarkan diri sebagai "sqlite".
	// Jangan pakai nama "sqlite3" — itu sudah dipegang mattn/go-sqlite3 (via
	// gorm.io/driver/sqlite) yang jadi stub tanpa CGO.
	_ "modernc.org/sqlite"
)

// IncomingMessage = isi pesan masuk (teks dan/atau media).
type IncomingMessage struct {
	Text      string // teks chat biasa atau caption media
	ActionID  string // ID internal dari tombol/list interaktif (tidak bergantung pada label)
	MediaType string // "", image, document, audio, video, sticker, location
	Mimetype  string
	FileName  string
	Data      []byte
	WAMsgID   string // ID pesan asli dari WhatsApp (untuk reply-to)
	WAMsgIDs  []string
	ChatJID   types.JID // alamat chat asli; penting untuk read receipt pada akun LID
	SenderJID types.JID // pengirim asli yang dipakai server WhatsApp
	ReplyTo   string    // ID pesan yg di-reply (dari ContextInfo)
	PushName  string    // nama profil pengirim (dari WA), untuk disimpan ke Contact
}

// MessageHandler dipanggil tiap pesan masuk, membawa ID agent (CS) penerima.
type MessageHandler func(agentID uint, sender types.JID, in IncomingMessage)

// OutgoingMessageHandler menerima pesan manual yang dikirim dari HP/WhatsApp Web
// lain pada akun yang sama. Pesan yang dikirim service sendiri tidak masuk jalur ini.
type OutgoingMessageHandler func(agentID uint, recipient types.JID, in IncomingMessage)

// DeviceLinkedHandler dipanggil saat agent berhasil login via QR.
type DeviceLinkedHandler func(agentID uint, jid, number string)

// GroupMessageMeta = ringkasan pesan grup untuk moderasi (tanpa unduh media).
type GroupMessageMeta struct {
	GroupJID   string
	SenderJID  string // JID asli pengirim (untuk revoke/kick)
	SenderPN   string // nomor telepon pengirim (untuk cocokkan allowlist/admin & tampil)
	SenderName string
	Text       string // isi/caption (tanpa unduh media)
	MessageID  string
}

// GroupMessageHandler dipanggil tiap pesan grup masuk (jalur moderasi, terpisah dari CS).
type GroupMessageHandler func(agentID uint, m GroupMessageMeta)

// ReceiptMeta membawa perubahan status pengiriman pesan KELUAR kita (delivered/read/played).
type ReceiptMeta struct {
	Recipient  string   // nomor lawan chat yang menerima/membaca pesan kita
	Status     string   // "delivered" | "read" | "played"
	MessageIDs []string // ID pesan yang statusnya berubah
	Timestamp  int64    // unix detik
}

// ReceiptHandler dipanggil saat ada receipt (status pengiriman) untuk pesan keluar kita.
type ReceiptHandler func(agentID uint, m ReceiptMeta)

type waInstance struct {
	mu             sync.Mutex
	labelSyncMu    sync.Mutex
	agentID        uint
	client         *whatsmeow.Client
	qrCode         string
	qrExpiry       time.Time // kapan kode QR saat ini akan diputar whatsmeow (untuk countdown akurat)
	status         string    // "disconnected", "qr", "connecting", "connected", "expired", "pairing", "pair_error"
	contactsSynced bool      // true setelah backfill nama kontak dari buku alamat (sekali per proses)

	// Jalur login via kode pairing (alternatif QR): user memasukkan kode 8 huruf di WA.
	pairing   bool   // true bila sesi ini sedang dalam alur kode pairing (bukan QR)
	pairPhone string // nomor tujuan pairing (format internasional tanpa 0 di depan)
	pairCode  string // kode 8 huruf dari WhatsApp untuk ditampilkan ke user
	pairErr   string // pesan error bila permintaan kode pairing gagal
}

var (
	instances      = make(map[uint]*waInstance)
	globalMu       sync.Mutex
	legacyDBPath   = "./wa-assistant.db"
	onMessage      MessageHandler
	onOwnMessage   OutgoingMessageHandler
	onLinked       DeviceLinkedHandler
	onGroupMessage GroupMessageHandler
	onReceipt      ReceiptHandler
	waLogger       waLog.Logger = waLog.Noop // logger whatsmeow (default senyap; diaktifkan via WA_LOG_LEVEL)
)

func InitWA(dbPath string) {
	if dbPath != "" {
		legacyDBPath = dbPath
	}
	// Aktifkan log whatsmeow (disconnect/stream-error/reconnect) untuk diagnosa koneksi.
	// WA_LOG_LEVEL: WARN (default), INFO untuk lebih detail, atau NONE/OFF untuk senyap.
	if lvl := strings.ToUpper(strings.TrimSpace(os.Getenv("WA_LOG_LEVEL"))); lvl == "" || (lvl != "NONE" && lvl != "OFF") {
		if lvl == "" {
			lvl = "WARN"
		}
		waLogger = waLog.Stdout("WA", lvl, false)
	}
}

// SetHandlers mendaftarkan callback global (dipanggil sekali dari main).
func SetHandlers(msg MessageHandler, linked DeviceLinkedHandler) {
	onMessage = msg
	onLinked = linked
}

func SetOutgoingMessageHandler(handler OutgoingMessageHandler) {
	onOwnMessage = handler
}

// SetGroupMessageHandler mendaftarkan callback moderasi pesan grup (dipanggil sekali dari main).
func SetGroupMessageHandler(h GroupMessageHandler) {
	onGroupMessage = h
}

// SetReceiptHandler mendaftarkan callback status pengiriman (receipt) pesan keluar.
func SetReceiptHandler(h ReceiptHandler) {
	onReceipt = h
}

// Handler event label WhatsApp (Business).
type LabelEditHandler func(agentID uint, labelID, name string, color int, deleted bool)
type LabelAssocHandler func(agentID uint, sender, labelID string, labeled bool)

var (
	onLabelEdit  LabelEditHandler
	onLabelAssoc LabelAssocHandler
)

func SetLabelHandlers(edit LabelEditHandler, assoc LabelAssocHandler) {
	onLabelEdit = edit
	onLabelAssoc = assoc
}

// WALabelSnapshot adalah satu label WhatsApp dari hasil sinkronisasi penuh.
type WALabelSnapshot struct {
	LabelID string
	Name    string
	Color   int
}

// WALabelContactSnapshot adalah relasi label ke nomor telepon asli (PN), bukan LID.
type WALabelContactSnapshot struct {
	LabelID string
	Number  string
}

// ConnectedHandler dipanggil sekali saat agent tersambung (untuk backfill nama kontak dari buku alamat).
type ConnectedHandler func(agentID uint)

var onConnected ConnectedHandler

func SetConnectedHandler(h ConnectedHandler) { onConnected = h }

// WA mengembalikan instance WhatsApp untuk satu agent, membuatnya jika belum ada.
func WA(agentID uint) *waInstance {
	globalMu.Lock()
	defer globalMu.Unlock()
	if w, ok := instances[agentID]; ok {
		return w
	}
	w := &waInstance{agentID: agentID, status: "disconnected"}
	instances[agentID] = w
	return w
}

// RemoveWA memutus sesi WA agent, mengeluarkannya dari memori (map instances), dan menghapus
// file sesinya. Dipanggil saat agent dihapus agar tidak bocor memori/koneksi/file descriptor.
func RemoveWA(agentID uint) {
	globalMu.Lock()
	w, ok := instances[agentID]
	delete(instances, agentID)
	globalMu.Unlock()
	if ok {
		_ = w.Logout() // putus client + lepas koneksi/goroutine
	}
	// Hapus file sesi SQLite per-agent. Agent 1 memakai file lama bersama — jangan dihapus.
	if agentID != 1 {
		base := fmt.Sprintf("data/wa-session-agent-%d.db", agentID)
		for _, suffix := range []string{"", "-wal", "-shm"} {
			os.Remove(base + suffix)
		}
	}
}

// sessionDSN: tiap agent punya file sesi SQLite sendiri (di-key per-agent, bukan per-JID
// yang mengandung ':'/'@'). Agent 1 memakai file lama agar sesi yang sudah login tidak hilang.
func sessionDSN(agentID uint) string {
	path := legacyDBPath
	if agentID != 1 {
		os.MkdirAll("data", 0o755)
		path = fmt.Sprintf("data/wa-session-agent-%d.db", agentID)
	}
	// modernc.org/sqlite (pure Go): gunakan _pragma alih-alih _foreign_keys=on
	return path + "?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)"
}

// FirstDeviceJID membaca device pada file sesi agent 1 (untuk migrasi single-number lama).
func FirstDeviceJID() string {
	container, err := sqlstore.New(context.Background(), "sqlite", sessionDSN(1), waLog.Noop)
	if err != nil {
		return ""
	}
	defer container.Close()
	devices, err := container.GetAllDevices(context.Background())
	if err != nil || len(devices) == 0 || devices[0].ID == nil {
		return ""
	}
	return devices[0].ID.String()
}

// Connect menyambungkan agent lewat QR. Param deviceJID tidak dipakai untuk path.
func (w *waInstance) Connect(_ string) (string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.client != nil {
		if w.client.Store.ID != nil {
			if !w.client.IsConnected() {
				_ = w.client.Connect()
			}
			return w.status, nil
		}
		w.client.Disconnect()
		w.client = nil
	}

	ctx := context.Background()
	container, err := sqlstore.New(ctx, "sqlite", sessionDSN(w.agentID), waLog.Noop)
	if err != nil {
		return "", fmt.Errorf("gagal buat store: %w", err)
	}
	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		return "", fmt.Errorf("gagal ambil device: %w", err)
	}

	w.client = whatsmeow.NewClient(device, waLogger)
	// Label WhatsApp disimpan di app-state. Tanpa opsi ini, label yang sudah ada
	// sebelum perangkat ditautkan tidak diterbitkan sebagai event saat full sync.
	w.client.EmitAppStateEventsOnFullSync = true
	w.client.AddEventHandler(w.handleEvent)

	if w.client.Store.ID == nil {
		qrChan, _ := w.client.GetQRChannel(ctx)
		if err := w.client.Connect(); err != nil {
			return "", fmt.Errorf("gagal connect: %w", err)
		}
		Go("watchQR", func() { w.watchQR(qrChan) })
		w.status = "qr"
		return "qr", nil
	}

	if err := w.client.Connect(); err != nil {
		return "", fmt.Errorf("gagal connect existing: %w", err)
	}
	w.status = "connected"
	return "connected", nil
}

// ConnectPairing menyambungkan agent lewat kode pairing alih-alih QR.
func (w *waInstance) ConnectPairing(_, phone string) (string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.client != nil {
		if w.client.Store.ID != nil {
			if !w.client.IsConnected() {
				_ = w.client.Connect()
			}
			return w.status, nil
		}
		w.client.Disconnect()
		w.client = nil
	}

	ctx := context.Background()
	container, err := sqlstore.New(ctx, "sqlite", sessionDSN(w.agentID), waLog.Noop)
	if err != nil {
		return "", fmt.Errorf("gagal buat store: %w", err)
	}
	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		return "", fmt.Errorf("gagal ambil device: %w", err)
	}

	w.client = whatsmeow.NewClient(device, waLogger)
	w.client.EmitAppStateEventsOnFullSync = true
	w.client.AddEventHandler(w.handleEvent)

	if w.client.Store.ID != nil {
		if err := w.client.Connect(); err != nil {
			return "", fmt.Errorf("gagal connect existing: %w", err)
		}
		w.status = "connected"
		return "connected", nil
	}

	qrChan, _ := w.client.GetQRChannel(ctx)
	if err := w.client.Connect(); err != nil {
		return "", fmt.Errorf("gagal connect: %w", err)
	}
	w.pairing = true
	w.pairPhone = phone
	w.pairCode = ""
	w.pairErr = ""
	w.status = "connecting"
	Go("watchQR", func() { w.watchQR(qrChan) })
	return "connecting", nil
}

func (w *waInstance) watchQR(qrChan <-chan whatsmeow.QRChannelItem) {
	for evt := range qrChan {
		if evt.Event == "code" {
			w.mu.Lock()
			// Mode pairing: kanal QR hanya penanda "koneksi siap". Minta kode 8 huruf sekali.
			if w.pairing {
				needCode := w.pairCode == "" && w.pairErr == ""
				phone := w.pairPhone
				w.mu.Unlock()
				if needCode {
					w.requestPairCode(phone)
				}
				continue
			}
			w.qrCode = evt.Code
			w.qrExpiry = time.Now().Add(evt.Timeout)
			w.status = "qr"
			w.mu.Unlock()
			continue
		}
		w.mu.Lock()
		w.qrCode = ""
		w.pairCode = ""
		w.pairing = false
		var jid *types.JID
		if w.client != nil {
			jid = w.client.Store.ID
		}
		if jid != nil {
			w.status = "connected"
		} else {
			w.status = "expired"
		}
		w.mu.Unlock()
		if jid != nil && onLinked != nil {
			onLinked(w.agentID, jid.String(), jid.User)
		}
		return
	}
}

// requestPairCode meminta kode pairing 8 huruf ke WhatsApp.
func (w *waInstance) requestPairCode(phone string) {
	code, err := w.client.PairPhone(context.Background(), phone, true, whatsmeow.PairClientChrome, "Chrome (Linux)")
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.pairing {
		return
	}
	if err != nil {
		w.pairErr = pairErrMessage(err)
		w.status = "pair_error"
		log.Printf("WA agent %d: gagal minta kode pairing: %v", w.agentID, err)
		return
	}
	w.pairCode = code
	w.status = "pairing"
	log.Printf("WA agent %d: kode pairing tersedia", w.agentID)
}

// GetPairCode = kode pairing 8 huruf saat ini.
func (w *waInstance) GetPairCode() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.pairCode
}

// GetPairError = pesan error alur pairing terakhir.
func (w *waInstance) GetPairError() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.pairErr
}

func pairErrMessage(err error) string {
	msg := err.Error()
	msg = strings.ToLower(msg)
	switch {
	case strings.Contains(msg, "bad request") || strings.Contains(msg, "400"):
		return "Nomor tidak valid atau belum terdaftar di WhatsApp. Pastikan nomor aktif dengan kode negara yang benar."
	case strings.Contains(msg, "too recent"):
		return "Terlalu sering mencoba. Tunggu beberapa menit sebelum mencoba lagi."
	default:
		return "Gagal membuat kode pairing: " + err.Error()
	}
}

func (w *waInstance) handleEvent(evt interface{}) {
	switch v := evt.(type) {
	case *events.Connected:
		// Tersambung / berhasil reconnect.
		w.mu.Lock()
		w.status = "connected"
		w.qrCode = ""
		firstSync := !w.contactsSynced
		w.contactsSynced = true
		w.mu.Unlock()
		log.Printf("WA agent %d: connected", w.agentID)
		// Backfill nama kontak dari buku alamat WA sekali per proses (di goroutine agar tak blok event).
		if firstSync && onConnected != nil {
			Go("onConnected", func() { onConnected(w.agentID) })
		}

	case *events.Disconnected:
		// Putus sementara (jaringan) — whatsmeow akan auto-reconnect sendiri.
		log.Printf("WA agent %d: disconnected (mencoba reconnect otomatis)", w.agentID)

	case *events.LoggedOut:
		// Sesi dicabut/di-logout dari HP atau di-banned — TIDAK bisa auto-recover, perlu scan ulang.
		// Hapus sesi basi & buang client supaya Connect berikutnya bisa membuat QR baru.
		w.mu.Lock()
		if w.client != nil {
			if w.client.Store != nil && w.client.Store.ID != nil {
				_ = w.client.Store.Delete(context.Background())
			}
			w.client.Disconnect()
			w.client = nil
		}
		w.status = "disconnected"
		w.qrCode = ""
		w.mu.Unlock()
		log.Printf("WA agent %d: LOGGED OUT (reason=%v) — sesi dibersihkan, perlu scan QR ulang", w.agentID, v.Reason)

	case *events.LabelEdit:
		if onLabelEdit != nil && v.Action != nil {
			onLabelEdit(w.agentID, v.LabelID, v.Action.GetName(), int(v.Action.GetColor()), v.Action.GetDeleted())
		}

	case *events.LabelAssociationChat:
		if onLabelAssoc != nil && v.Action != nil {
			number, err := phoneNumberForJID(context.Background(), w.client, v.JID)
			if err != nil {
				log.Printf("WA agent %d: label %s gagal mengubah JID %s ke nomor: %v", w.agentID, v.LabelID, v.JID, err)
				return
			}
			if number != "" {
				onLabelAssoc(w.agentID, number, v.LabelID, v.Action.GetLabeled())
			}
		}

	case *events.Receipt:
		// Status pengiriman pesan KELUAR kita (delivered/read/played) dari lawan chat.
		// Hanya DM; abaikan grup & marker milik kita sendiri (ReadSelf/PlayedSelf).
		if onReceipt == nil || v.IsGroup {
			return
		}
		var status string
		switch v.Type {
		case types.ReceiptTypeDelivered:
			status = "delivered"
		case types.ReceiptTypeRead:
			status = "read"
		case types.ReceiptTypePlayed:
			status = "played"
		default:
			return
		}
		ids := make([]string, 0, len(v.MessageIDs))
		for _, id := range v.MessageIDs {
			ids = append(ids, string(id))
		}
		meta := ReceiptMeta{Recipient: v.Sender.User, Status: status, MessageIDs: ids, Timestamp: v.Timestamp.Unix()}
		Go("onReceipt", func() { onReceipt(w.agentID, meta) })

	case *events.Message:
		// Pesan manual dari HP/perangkat tertaut lain dicatat sebagai takeover manusia.
		// Event kiriman service sendiri tidak memiliki DeviceSentMeta dan tetap dilewati.
		if v.Info.IsFromMe {
			if v.Info.DeviceSentMeta != nil && onOwnMessage != nil && !v.Info.IsGroup {
				in, ok := w.extractIncoming(v)
				if ok {
					in.WAMsgID = string(v.Info.ID)
					recipient := v.Info.Chat
					if recipient.Server == types.HiddenUserServer && !v.Info.RecipientAlt.IsEmpty() {
						recipient = v.Info.RecipientAlt
					}
					Go("onOwnMessage", func() { onOwnMessage(w.agentID, recipient, in) })
				}
			}
			return
		}
		// Pesan grup TIDAK masuk pipeline CS (AI tidak balas di grup). Diarahkan ke jalur
		// moderasi terpisah, dan hanya kalau handler moderasi terpasang.
		if v.Info.IsGroup {
			if onGroupMessage != nil {
				sender := v.Info.Sender
				if sender.Server == types.HiddenUserServer && !v.Info.SenderAlt.IsEmpty() {
					sender = v.Info.SenderAlt
				}
				meta := GroupMessageMeta{
					GroupJID:   v.Info.Chat.String(),
					SenderJID:  v.Info.Sender.String(),
					SenderPN:   sender.User,
					SenderName: v.Info.PushName,
					Text:       groupMessageText(v),
					MessageID:  string(v.Info.ID),
				}
				Go("onGroupMessage", func() { onGroupMessage(w.agentID, meta) })
			}
			return
		}
		// Read receipt adalah pilihan per nomor. Default manual agar pesan tidak langsung
		// centang biru hanya karena service menerima event di background.
		var agent models.Agent
		if database.DB.Select("auto_read").First(&agent, w.agentID).Error == nil && agent.AutoRead {
			if err := w.client.MarkRead(context.Background(), []types.MessageID{v.Info.ID}, time.Now(), v.Info.Chat, v.Info.Sender); err != nil {
				log.Printf("WA agent %d gagal menandai pesan dibaca: %v", w.agentID, err)
			}
		}

		in, ok := w.extractIncoming(v)
		if !ok || onMessage == nil {
			return
		}
		in.WAMsgID = v.Info.ID
		in.WAMsgIDs = []string{string(v.Info.ID)}
		in.ChatJID = v.Info.Chat
		in.SenderJID = v.Info.Sender
		in.PushName = v.Info.PushName
		// Kontak modern bisa beralamat LID (privasi). Pakai nomor telepon asli (SenderAlt)
		// agar yang tersimpan & ditampilkan adalah nomor WA betulan, bukan angka LID.
		contact := v.Info.Sender
		if contact.Server == types.HiddenUserServer && !v.Info.SenderAlt.IsEmpty() {
			contact = v.Info.SenderAlt
		}
		Go("onMessage", func() { onMessage(w.agentID, contact, in) })
	}
}

func (w *waInstance) GetQR() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.qrCode
}

// GetQRTTL = sisa detik sebelum kode QR saat ini diputar whatsmeow (0 bila bukan status qr).
func (w *waInstance) GetQRTTL() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.status != "qr" || w.qrExpiry.IsZero() {
		return 0
	}
	if s := int(time.Until(w.qrExpiry).Seconds()); s > 0 {
		return s
	}
	return 0
}

func (w *waInstance) GetStatus() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	// Kalau cache bilang "connected" tapi socket sebenarnya turun, laporkan "connecting"
	// supaya dashboard tidak menipu "Online" padahal tidak bisa kirim.
	if w.status == "connected" && (w.client == nil || !w.client.IsConnected()) {
		return "connecting"
	}
	return w.status
}

// IsConnected melaporkan apakah socket WA benar-benar hidup & ter-login (bukan sekadar
// status cache). Dipakai broadcast: w.status bisa basi "connected" walau koneksi sudah turun.
func (w *waInstance) IsConnected() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.client != nil && w.client.IsConnected() && w.client.IsLoggedIn()
}

// reconnectIfNeeded menyambung ulang bila sesi SEHARUSNYA tersambung (intent status "connected",
// device sudah login) tapi socket-nya terputus. Aman: sesi yang di-suspend/logout punya status
// "disconnected" + client nil, jadi dilewati (watchdog tidak melawan disconnect yang disengaja).
func (w *waInstance) reconnectIfNeeded() {
	w.mu.Lock()
	client, intend := w.client, w.status == "connected"
	w.mu.Unlock()
	if !intend || client == nil || client.Store.ID == nil || client.IsConnected() {
		return
	}
	log.Printf("Watchdog: WA agent %d terputus — mencoba menyambung ulang", w.agentID)
	if err := client.Connect(); err != nil {
		log.Printf("Watchdog: reconnect agent %d gagal: %v", w.agentID, err)
	}
}

// StartReconnectWatchdog memantau semua sesi WA tiap interval & menyambung ulang yang terputus
// tanpa perlu restart server (menutup celah "bot diam-diam offline").
func StartReconnectWatchdog(interval time.Duration) {
	go func() {
		t := time.NewTicker(interval)
		for range t.C {
			globalMu.Lock()
			list := make([]*waInstance, 0, len(instances))
			for _, w := range instances {
				list = append(list, w)
			}
			globalMu.Unlock()
			for _, w := range list {
				w.reconnectIfNeeded()
			}
		}
	}()
}

// GetInfo mengembalikan nomor & nama profil WhatsApp yang sedang terhubung.
func (w *waInstance) GetInfo() (number, name string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.client == nil || w.client.Store.ID == nil {
		return "", ""
	}
	return w.client.Store.ID.User, w.client.Store.PushName
}

// Logout memutus & menghapus sesi WhatsApp (unlink). Setelah ini perlu scan QR lagi untuk relink.
func (w *waInstance) Logout() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.client != nil {
		ctx := context.Background()
		if w.client.IsLoggedIn() {
			_ = w.client.Logout(ctx)
		} else {
			w.client.Disconnect()
		}
		w.client = nil
	}
	w.qrCode = ""
	w.status = "disconnected"
	return nil
}

// SendReply mengirim balasan yang mengutip pesan tertentu (reply-to).
func (w *waInstance) SendReply(toNumber, message, replyToID string) error {
	return w.SendMessage(types.NewJID(toNumber, types.DefaultUserServer), message, replyToID)
}

// SendReplyToJID mengirim balasan ke JID penuh, termasuk grup.
func (w *waInstance) SendReplyToJID(jidStr, message, replyToID string) error {
	jid, err := types.ParseJID(jidStr)
	if err != nil {
		return fmt.Errorf("JID tujuan tidak valid (%q): %w", jidStr, err)
	}
	return w.SendMessage(jid, message, replyToID)
}

// Typing mengirim indikator "mengetik" ke kontak.
func (w *waInstance) Typing(toNumber string, composing bool) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}
	jid := types.NewJID(toNumber, types.DefaultUserServer)
	state := types.ChatPresenceComposing
	if !composing {
		state = types.ChatPresencePaused
	}
	return client.SendChatPresence(context.Background(), jid, state, types.ChatPresenceMediaText)
}

// RevokeMessage menghapus (unsend) pesan yang sudah dikirim ke kontak.
func (w *waInstance) RevokeMessage(toNumber string, msgID types.MessageID) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}
	jid := types.NewJID(toNumber, types.DefaultUserServer)
	ownJID := client.Store.ID
	if ownJID == nil {
		return fmt.Errorf("akun WA belum login")
	}
	_, err := client.SendMessage(context.Background(), jid, client.BuildRevoke(jid, *ownJID, msgID))
	return err
}

// SendText mengirim pesan ke nomor bare (mis "628123") tanpa pemanggil perlu menyusun JID.
func (w *waInstance) SendText(toNumber, message string) error {
	return w.SendMessage(types.NewJID(toNumber, types.DefaultUserServer), message)
}

// SendTextToJID mengirim teks ke JID apa pun: grup ("..@g.us") maupun nomor ("..@s.whatsapp.net").
// Dipakai broadcast grup, di mana penerima berupa JID grup, bukan nomor telepon.
func (w *waInstance) SendTextToJID(jidStr, message string) error {
	jid, err := types.ParseJID(jidStr)
	if err != nil {
		return fmt.Errorf("JID tujuan tidak valid (%q): %w", jidStr, err)
	}
	return w.SendMessage(jid, message)
}

// WAServerErrorCode mengambil kode penolakan yang dikirim server WhatsApp dari error
// SendMessage. Contoh: "server returned error 463" -> 463.
func WAServerErrorCode(err error) (int, bool) {
	if err == nil || !errors.Is(err, whatsmeow.ErrServerReturnedError) {
		return 0, false
	}
	parts := strings.Fields(err.Error())
	if len(parts) == 0 {
		return 0, false
	}
	code, parseErr := strconv.Atoi(parts[len(parts)-1])
	return code, parseErr == nil
}

// IsGroupJID mengembalikan true bila s berupa JID grup WhatsApp ("...@g.us").
// Dipakai untuk membedakan penerima grup dari nomor pribadi pada alur blast.
func IsGroupJID(s string) bool {
	return strings.HasSuffix(s, "@g.us")
}

// NormalizePhone membersihkan nomor jadi format digit internasional (mis. "08.." -> "628..").
func NormalizePhone(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	d := b.String()
	switch {
	case d == "":
		return ""
	case strings.HasPrefix(d, "0"):
		return "62" + d[1:]
	case strings.HasPrefix(d, "8"): // nomor lokal tanpa awalan 0/62
		return "62" + d
	default:
		return d
	}
}

// ValidatePhoneForWA menilai apakah nomor (setelah dinormalisasi) laik untuk dikirimi
// pesan WhatsApp. Aturannya:
//   - Tidak boleh kosong.
//   - Digit pertama harus 1–9 (bukan '0' atau '+', karena NormalizePhone sudah membuang non-digit).
//   - Untuk awalan '62' (kode negara Indonesia): panjang 11–13 digit.
//     Tujuannya menolak nomor yang terlalu panjang (mis. 15 digit) yang lolos dari
//     filter WA tapi jelas salah ketik atau karakter tercampur.
//   - Untuk negara lain (awalan 1–9 selain '62'): panjang 10–15 digit (range generik E.164).
//
// Mengembalikan (true, "") jika lolos; sebaliknya (false, alasan) untuk ditampilkan
// ke UI / log sebagai pesan gagal yang manusiawi.
func ValidatePhoneForWA(normalized string) (bool, string) {
	if normalized == "" {
		return false, "nomor kosong"
	}
	first := normalized[0]
	if first < '1' || first > '9' {
		return false, "awalan harus 1–9"
	}
	if strings.HasPrefix(normalized, "62") {
		if len(normalized) < 11 || len(normalized) > 13 {
			return false, "panjang nomor Indonesia harus 11–13 digit"
		}
	} else if len(normalized) < 10 || len(normalized) > 15 {
		return false, "panjang nomor harus 10–15 digit"
	}
	return true, ""
}

// CheckOnWhatsApp memeriksa apakah tiap nomor benar-benar terdaftar di WhatsApp.
// Mengembalikan map nomor-ternormalisasi -> terdaftar. Berguna untuk memvalidasi
// daftar penerima sebelum blast: nomor yang tidak terdaftar bisa dibuang lebih awal
// sehingga mengurangi pengiriman gagal & risiko pembatasan nomor pengirim.
func (w *waInstance) CheckOnWhatsApp(numbers []string) (map[string]bool, error) {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return nil, fmt.Errorf("client WA tidak terhubung")
	}
	// Normalisasi + dedup; whatsmeow mengharap format "+E164".
	queries := make([]string, 0, len(numbers))
	seen := map[string]bool{}
	for _, n := range numbers {
		norm := NormalizePhone(n)
		if norm == "" || seen[norm] {
			continue
		}
		seen[norm] = true
		queries = append(queries, "+"+norm)
	}
	out := make(map[string]bool, len(queries))
	if len(queries) == 0 {
		return out, nil
	}
	resp, err := client.IsOnWhatsApp(context.Background(), queries)
	if err != nil {
		return nil, err
	}
	for _, r := range resp {
		out[NormalizePhone(r.Query)] = r.IsIn
	}
	return out, nil
}

// WAGroup = grup yang diikuti akun WhatsApp tertaut.
type WAGroup struct {
	JID          string `json:"jid"`
	Name         string `json:"name"`
	Participants int    `json:"participants"`
	// BotIsAdmin = apakah nomor yang tertaut (Wai) menjadi admin di grup ini.
	// Penentu apakah fitur moderasi (kick/hapus) bisa dijalankan di grup tersebut.
	BotIsAdmin bool `json:"bot_is_admin"`
}

// botIsAdminOf mengecek apakah akun yang tertaut adalah admin/super-admin di grup g.
// Mencocokkan identitas bot lewat nomor telepon (Store.ID) maupun LID (Store.LID),
// karena anggota grup bisa beralamat sebagai nomor atau LID.
func botIsAdminOf(client *whatsmeow.Client, g *types.GroupInfo) bool {
	if client.Store.ID == nil {
		return false
	}
	selfPN := client.Store.ID.User
	selfLID := client.Store.LID.User // kosong kalau belum punya LID
	for _, p := range g.Participants {
		isSelf := p.JID.User == selfPN || p.PhoneNumber.User == selfPN
		if selfLID != "" && p.LID.User == selfLID {
			isSelf = true
		}
		if isSelf {
			return p.IsAdmin || p.IsSuperAdmin
		}
	}
	return false
}

// GetGroups mengambil daftar grup yang diikuti beserta status admin bot di tiap grup.
func (w *waInstance) GetGroups() ([]WAGroup, error) {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return nil, fmt.Errorf("client WA tidak terhubung")
	}
	groups, err := client.GetJoinedGroups(context.Background())
	if err != nil {
		return nil, err
	}
	out := make([]WAGroup, 0, len(groups))
	for _, g := range groups {
		out = append(out, WAGroup{
			JID: g.JID.String(), Name: g.Name, Participants: len(g.Participants),
			BotIsAdmin: botIsAdminOf(client, g),
		})
	}
	return out, nil
}

// groupMessageText mengambil teks/caption pesan grup TANPA mengunduh media (hemat & cepat).
func groupMessageText(v *events.Message) string {
	m := v.Message
	if m == nil {
		return ""
	}
	if t := m.GetConversation(); t != "" {
		return t
	}
	if e := m.GetExtendedTextMessage(); e != nil {
		return e.GetText()
	}
	if img := m.GetImageMessage(); img != nil {
		return img.GetCaption()
	}
	if vid := m.GetVideoMessage(); vid != nil {
		return vid.GetCaption()
	}
	if doc := m.GetDocumentMessage(); doc != nil {
		return doc.GetCaption()
	}
	return ""
}

// GroupModerationInfo mengembalikan himpunan identitas admin grup + apakah bot sendiri admin.
// Satu panggilan GetGroupInfo dipakai untuk keduanya; pemanggil sebaiknya men-cache hasilnya.
func (w *waInstance) GroupModerationInfo(groupJID string) (admins map[string]bool, botIsAdmin bool, err error) {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return nil, false, fmt.Errorf("client WA tidak terhubung")
	}
	gjid, err := types.ParseJID(groupJID)
	if err != nil {
		return nil, false, err
	}
	info, err := client.GetGroupInfo(context.Background(), gjid)
	if err != nil {
		return nil, false, err
	}
	admins = map[string]bool{}
	for _, p := range info.Participants {
		if p.IsAdmin || p.IsSuperAdmin {
			if p.JID.User != "" {
				admins[p.JID.User] = true
			}
			if p.PhoneNumber.User != "" {
				admins[p.PhoneNumber.User] = true
			}
			if p.LID.User != "" {
				admins[p.LID.User] = true
			}
		}
	}
	return admins, botIsAdminOf(client, info), nil
}

// DeleteGroupMessage menghapus (revoke) pesan anggota lain di grup — butuh bot jadi admin.
func (w *waInstance) DeleteGroupMessage(groupJID, senderJID, msgID string) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}
	gjid, err := types.ParseJID(groupJID)
	if err != nil {
		return err
	}
	sjid, err := types.ParseJID(senderJID)
	if err != nil {
		return err
	}
	_, err = client.SendMessage(context.Background(), gjid, client.BuildRevoke(gjid, sjid, types.MessageID(msgID)))
	return err
}

// KickFromGroup mengeluarkan satu anggota dari grup — butuh bot jadi admin.
func (w *waInstance) KickFromGroup(groupJID, userJID string) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}
	gjid, err := types.ParseJID(groupJID)
	if err != nil {
		return err
	}
	ujid, err := types.ParseJID(userJID)
	if err != nil {
		return err
	}
	_, err = client.UpdateGroupParticipants(context.Background(), gjid, []types.JID{ujid}, whatsmeow.ParticipantChangeRemove)
	return err
}

// GetGroupMembers mengambil nomor anggota sebuah grup (untuk dijadikan penerima).
func (w *waInstance) GetGroupMembers(jidStr string) ([]WAContact, error) {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return nil, fmt.Errorf("client WA tidak terhubung")
	}
	jid, err := types.ParseJID(jidStr)
	if err != nil {
		return nil, err
	}
	gi, err := client.GetGroupInfo(context.Background(), jid)
	if err != nil {
		return nil, err
	}
	out := make([]WAContact, 0, len(gi.Participants))
	for _, p := range gi.Participants {
		num := ""
		if p.PhoneNumber.User != "" {
			num = p.PhoneNumber.User
		} else if p.JID.Server == types.DefaultUserServer {
			num = p.JID.User
		}
		if num == "" {
			continue
		}
		out = append(out, WAContact{Number: num, Name: p.DisplayName})
	}
	return out, nil
}

// SyncLabels mengambil snapshot label terbaru dari app-state WhatsApp. Snapshot
// dikembalikan ke handler agar tabel aplikasi bisa diganti secara transaksional;
// FetchAppState di sini sengaja tidak langsung mendispatch event satu per satu.
func (w *waInstance) SyncLabels(ctx context.Context) ([]WALabelSnapshot, []WALabelContactSnapshot, error) {
	w.labelSyncMu.Lock()
	defer w.labelSyncMu.Unlock()

	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() || !client.IsLoggedIn() {
		return nil, nil, errors.New("WhatsApp belum tersambung")
	}

	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 45*time.Second)
		defer cancel()
	}
	client.EmitAppStateEventsOnFullSync = true
	eventsToApply, err := client.DangerousInternals().FetchAppState(ctx, appstate.WAPatchRegular, true, false)
	if err != nil {
		return nil, nil, fmt.Errorf("gagal sinkronisasi label WhatsApp: %w", err)
	}

	labels := make(map[string]WALabelSnapshot)
	contacts := make(map[string]WALabelContactSnapshot)
	for _, raw := range eventsToApply {
		switch evt := raw.(type) {
		case *events.LabelEdit:
			if evt.Action == nil || evt.LabelID == "" {
				continue
			}
			if evt.Action.GetDeleted() {
				delete(labels, evt.LabelID)
				for key, relation := range contacts {
					if relation.LabelID == evt.LabelID {
						delete(contacts, key)
					}
				}
				continue
			}
			labels[evt.LabelID] = WALabelSnapshot{
				LabelID: evt.LabelID,
				Name:    evt.Action.GetName(),
				Color:   int(evt.Action.GetColor()),
			}
		case *events.LabelAssociationChat:
			if evt.Action == nil || evt.LabelID == "" {
				continue
			}
			number, mapErr := phoneNumberForJID(ctx, client, evt.JID)
			if mapErr != nil {
				log.Printf("WA agent %d: lewati relasi label %s untuk JID %s: %v", w.agentID, evt.LabelID, evt.JID, mapErr)
				continue
			}
			if number == "" {
				continue
			}
			key := evt.LabelID + "\x00" + number
			if evt.Action.GetLabeled() {
				contacts[key] = WALabelContactSnapshot{LabelID: evt.LabelID, Number: number}
			} else {
				delete(contacts, key)
			}
		}
	}

	labelList := make([]WALabelSnapshot, 0, len(labels))
	for _, label := range labels {
		labelList = append(labelList, label)
	}
	sort.Slice(labelList, func(i, j int) bool {
		return strings.ToLower(labelList[i].Name) < strings.ToLower(labelList[j].Name)
	})
	contactList := make([]WALabelContactSnapshot, 0, len(contacts))
	for _, relation := range contacts {
		if _, exists := labels[relation.LabelID]; exists {
			contactList = append(contactList, relation)
		}
	}
	sort.Slice(contactList, func(i, j int) bool {
		if contactList[i].LabelID == contactList[j].LabelID {
			return contactList[i].Number < contactList[j].Number
		}
		return contactList[i].LabelID < contactList[j].LabelID
	})
	return labelList, contactList, nil
}

// ApplyLabel menerapkan label WhatsApp ke kontak dan menyinkronkan ke server WhatsApp.
// Dua arah: DB lokal langsung diupdate + WhatsApp server menerima patch app-state.
func (w *waInstance) ApplyLabel(sender, labelID string, labeled bool) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() || !client.IsLoggedIn() {
		return errors.New("WhatsApp belum tersambung")
	}

	// Parse nomor ke JID
	jid, err := parseJIDForWA(sender)
	if err != nil {
		return fmt.Errorf("JID tidak valid: %w", err)
	}

	// Kirim patch app-state ke WhatsApp
	patch := appstate.BuildLabelChat(jid, labelID, labeled)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	if err := client.SendAppState(ctx, patch); err != nil {
		return fmt.Errorf("gagal kirim label ke WhatsApp: %w", err)
	}

	// Update DB lokal (biar UI langsung reflect)
	if labeled {
		database.DB.Where(models.ChatLabel{AgentID: w.agentID, LabelID: labelID, Sender: sender}).FirstOrCreate(&models.ChatLabel{})
	} else {
		database.DB.Where("agent_id = ? AND label_id = ? AND sender = ?", w.agentID, labelID, sender).Delete(&models.ChatLabel{})
	}

	log.Printf("WA agent %d: label '%s' %s ke %s (synced ke WhatsApp)", w.agentID, labelID, map[bool]string{true: "applied", false: "removed"}[labeled], sender)
	return nil
}

// parseJIDForWA mengonversi nomor HP ke types.JID WhatsApp.
func parseJIDForWA(number string) (types.JID, error) {
	number = strings.TrimSpace(number)
	if number == "" {
		return types.JID{}, fmt.Errorf("nomor kosong")
	}
	// Gunakan NewJID dengan user dan server terpisah
	return types.NewJID(number, types.DefaultUserServer), nil
}

func phoneNumberForJID(ctx context.Context, client *whatsmeow.Client, jid types.JID) (string, error) {
	jid = jid.ToNonAD()
	switch jid.Server {
	case types.DefaultUserServer, types.LegacyUserServer:
		return jid.User, nil
	case types.HiddenUserServer:
		if client == nil || client.Store == nil || client.Store.LIDs == nil {
			return "", errors.New("penyimpanan mapping LID belum tersedia")
		}
		pn, err := client.Store.LIDs.GetPNForLID(ctx, jid)
		if err != nil {
			return "", err
		}
		if pn.IsEmpty() {
			return "", errors.New("mapping nomor untuk LID belum tersedia")
		}
		return pn.User, nil
	default:
		return "", nil
	}
}

// WAContact = satu kontak dari buku alamat akun WhatsApp yang tertaut.
type WAContact struct {
	Number string `json:"number"`
	Name   string `json:"name"`
}

// GetContacts mengambil daftar kontak (buku alamat) dari akun WhatsApp yang tertaut.
func (w *waInstance) GetContacts() ([]WAContact, error) {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return nil, fmt.Errorf("client WA tidak terhubung")
	}
	all, err := client.Store.Contacts.GetAllContacts(context.Background())
	if err != nil {
		return nil, err
	}
	out := make([]WAContact, 0, len(all))
	for jid, info := range all {
		if jid.Server != types.DefaultUserServer || jid.User == "" {
			continue // hanya nomor telepon (bukan LID/grup)
		}
		name := info.FullName
		for _, alt := range []string{info.FirstName, info.PushName, info.BusinessName} {
			if name == "" {
				name = alt
			}
		}
		out = append(out, WAContact{Number: jid.User, Name: name})
	}
	return out, nil
}

// NumberCheck = hasil pengecekan satu nomor di WhatsApp.
type NumberCheck struct {
	Input      string `json:"input"`
	Number     string `json:"number"` // nomor ternormalisasi untuk dikirim
	Registered bool   `json:"registered"`
}

// CheckNumbers memeriksa daftar nomor apakah terdaftar di WhatsApp (IsOnWhatsApp).
func (w *waInstance) CheckNumbers(numbers []string) ([]NumberCheck, error) {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return nil, fmt.Errorf("client WA tidak terhubung")
	}
	queries := make([]string, 0, len(numbers))
	for _, n := range numbers {
		if d := NormalizePhone(n); d != "" {
			queries = append(queries, "+"+d)
		}
	}
	if len(queries) == 0 {
		return nil, nil
	}
	resp, err := client.IsOnWhatsApp(context.Background(), queries)
	if err != nil {
		return nil, err
	}
	out := make([]NumberCheck, 0, len(resp))
	for _, r := range resp {
		num := strings.TrimPrefix(r.Query, "+")
		if r.IsIn && r.JID.User != "" {
			num = r.JID.User
		}
		out = append(out, NumberCheck{Input: r.Query, Number: num, Registered: r.IsIn})
	}
	return out, nil
}

// LIDForPN mengembalikan LID (angka) untuk satu nomor telepon, bila whatsmeow punya pemetaannya.
// Dipakai mencocokkan riwayat chat lama yang tersimpan sebagai LID, bukan nomor telepon.
func (w *waInstance) LIDForPN(phone string) string {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || client.Store == nil {
		return ""
	}
	lid, err := client.Store.LIDs.GetLIDForPN(context.Background(), types.NewJID(phone, types.DefaultUserServer))
	if err != nil || lid.IsEmpty() {
		return ""
	}
	return lid.User
}

// PNForLID mengembalikan nomor telepon untuk sebuah LID (kebalikan LIDForPN).
// Dipakai merapikan data lama yang menyimpan pengirim sebagai LID.
func (w *waInstance) PNForLID(lid string) string {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || client.Store == nil {
		return ""
	}
	pn, err := client.Store.LIDs.GetPNForLID(context.Background(), types.NewJID(lid, types.HiddenUserServer))
	if err != nil || pn.IsEmpty() {
		return ""
	}
	return pn.User
}

// extractIncoming mengubah pesan WA jadi IncomingMessage (teks atau media yang sudah di-download).
func (w *waInstance) extractIncoming(v *events.Message) (IncomingMessage, bool) {
	m := v.Message
	if t := m.GetConversation(); t != "" {
		return IncomingMessage{Text: normalizeLocationLinkText(t)}, true
	}
	if ext := m.GetExtendedTextMessage(); ext != nil && ext.GetText() != "" {
		var replyTo string
		if ci := ext.GetContextInfo(); ci != nil {
			replyTo = ci.GetStanzaID()
		}
		return IncomingMessage{Text: normalizeLocationLinkText(ext.GetText()), ReplyTo: replyTo}, true
	}
	if text, actionID, replyTo, ok := interactiveReplyText(m); ok {
		return IncomingMessage{Text: text, ActionID: actionID, ReplyTo: replyTo}, true
	}
	ctx := context.Background()
	switch {
	case m.GetLocationMessage() != nil:
		loc := m.GetLocationMessage()
		return IncomingMessage{
			Text:      locationContext(loc.GetName(), loc.GetAddress(), loc.GetComment(), loc.GetURL(), loc.GetDegreesLatitude(), loc.GetDegreesLongitude(), false),
			MediaType: "location",
			ReplyTo:   contextReplyID(loc.GetContextInfo()),
		}, true
	case m.GetLiveLocationMessage() != nil:
		loc := m.GetLiveLocationMessage()
		return IncomingMessage{
			Text:      locationContext("", "", loc.GetCaption(), "", loc.GetDegreesLatitude(), loc.GetDegreesLongitude(), true),
			MediaType: "location",
			ReplyTo:   contextReplyID(loc.GetContextInfo()),
		}, true
	case m.GetImageMessage() != nil:
		img := m.GetImageMessage()
		data, err := w.client.Download(ctx, img)
		if err != nil {
			log.Printf("WA agent %d: gagal download gambar: %v", w.agentID, err)
			return IncomingMessage{}, false
		}
		return IncomingMessage{Text: img.GetCaption(), MediaType: "image", Mimetype: img.GetMimetype(), Data: data}, true
	case m.GetDocumentMessage() != nil:
		doc := m.GetDocumentMessage()
		data, err := w.client.Download(ctx, doc)
		if err != nil {
			log.Printf("WA agent %d: gagal download dokumen: %v", w.agentID, err)
			return IncomingMessage{}, false
		}
		return IncomingMessage{Text: doc.GetCaption(), MediaType: "document", Mimetype: doc.GetMimetype(), FileName: doc.GetFileName(), Data: data}, true
	case m.GetVideoMessage() != nil:
		vid := m.GetVideoMessage()
		data, err := w.client.Download(ctx, vid)
		if err != nil {
			log.Printf("WA agent %d: gagal download video: %v", w.agentID, err)
			return IncomingMessage{}, false
		}
		return IncomingMessage{Text: vid.GetCaption(), MediaType: "video", Mimetype: vid.GetMimetype(), Data: data}, true
	case m.GetAudioMessage() != nil:
		aud := m.GetAudioMessage()
		data, err := w.client.Download(ctx, aud)
		if err != nil {
			log.Printf("WA agent %d: gagal download audio: %v", w.agentID, err)
			return IncomingMessage{}, false
		}
		return IncomingMessage{MediaType: "audio", Mimetype: aud.GetMimetype(), Data: data}, true
	case m.GetStickerMessage() != nil:
		st := m.GetStickerMessage()
		data, err := w.client.Download(ctx, st)
		if err != nil {
			return IncomingMessage{}, false
		}
		return IncomingMessage{MediaType: "sticker", Mimetype: st.GetMimetype(), Data: data}, true
	}
	return IncomingMessage{}, false // tipe pesan lain diabaikan
}

func normalizeLocationLinkText(text string) string {
	// Label ringan di extract; pengayaan penuh (resolve short link + koordinat)
	// dilakukan di EnrichUserMessageForAI sebelum ChatWithKnowledge.
	lower := strings.ToLower(text)
	locationLink := strings.Contains(lower, "maps.app.goo.gl/") ||
		strings.Contains(lower, "google.com/maps") ||
		strings.Contains(lower, "maps.google.") ||
		strings.Contains(lower, "goo.gl/maps/") ||
		strings.Contains(lower, "google.co.id/maps")
	if !locationLink {
		return text
	}
	return "Pelanggan sudah membagikan link lokasi sebagai titik/alamat tujuan. Gunakan link ini dan jangan meminta pelanggan mengirim atau mengonfirmasi lokasi lagi.\n" + text
}

func contextReplyID(info *waProto.ContextInfo) string {
	if info == nil {
		return ""
	}
	return info.GetStanzaID()
}

// locationContext membuat lokasi dapat langsung dipakai AI/alur checkout sebagai
// titik tujuan final. Link bawaan WhatsApp dipertahankan; bila kosong dibuatkan
// link Google Maps dari koordinat tanpa memerlukan API geocoding tambahan.
func locationContext(name, address, comment, rawURL string, latitude, longitude float64, live bool) string {
	kind := "Lokasi yang dibagikan pelanggan"
	if live {
		kind = "Live location yang dibagikan pelanggan"
	}
	lines := []string{kind + " (gunakan sebagai titik/alamat tujuan yang sudah diberikan; jangan meminta pelanggan mengirim atau mengonfirmasi lokasi lagi)."}
	if value := strings.TrimSpace(name); value != "" {
		lines = append(lines, "Nama lokasi: "+value)
	}
	if value := strings.TrimSpace(address); value != "" {
		lines = append(lines, "Alamat: "+value)
	}
	if value := strings.TrimSpace(comment); value != "" {
		lines = append(lines, "Catatan: "+value)
	}
	if latitude != 0 || longitude != 0 {
		lines = append(lines, fmt.Sprintf("Koordinat: %.7f, %.7f", latitude, longitude))
		if strings.TrimSpace(rawURL) == "" {
			rawURL = fmt.Sprintf("https://maps.google.com/?q=%.7f,%.7f", latitude, longitude)
		}
	}
	if value := strings.TrimSpace(rawURL); value != "" {
		lines = append(lines, "Google Maps: "+value)
	}
	return strings.Join(lines, "\n")
}

// interactiveReplyText mengubah klik tombol/list WhatsApp menjadi teks biasa agar
// seluruh alur yang sudah ada (AI, Auto-Reply, dan Alur Otomatis) dapat memprosesnya.
// Native Flow adalah format tombol modern, sementara tiga format lain dipertahankan
// untuk kompatibilitas dengan respons dari versi WhatsApp yang berbeda.
func interactiveReplyText(m *waProto.Message) (text, actionID, replyTo string, ok bool) {
	if response := m.GetInteractiveResponseMessage(); response != nil {
		if contextInfo := response.GetContextInfo(); contextInfo != nil {
			replyTo = contextInfo.GetStanzaID()
		}
		if body := strings.TrimSpace(response.GetBody().GetText()); body != "" {
			actionID = nativeFlowActionID(response.GetNativeFlowResponseMessage())
			return body, actionID, replyTo, true
		}
		if native := response.GetNativeFlowResponseMessage(); native != nil {
			var params struct {
				ID          string `json:"id"`
				DisplayText string `json:"display_text"`
				Title       string `json:"title"`
			}
			if err := json.Unmarshal([]byte(native.GetParamsJSON()), &params); err == nil {
				if label := strings.TrimSpace(params.DisplayText); label != "" {
					return label, strings.TrimSpace(params.ID), replyTo, true
				}
				if label := strings.TrimSpace(params.Title); label != "" {
					return label, strings.TrimSpace(params.ID), replyTo, true
				}
				if label := buttonIDText(params.ID); label != "" {
					return label, strings.TrimSpace(params.ID), replyTo, true
				}
			}
		}
	}
	if response := m.GetButtonsResponseMessage(); response != nil {
		if contextInfo := response.GetContextInfo(); contextInfo != nil {
			replyTo = contextInfo.GetStanzaID()
		}
		if label := strings.TrimSpace(response.GetSelectedDisplayText()); label != "" {
			return label, strings.TrimSpace(response.GetSelectedButtonID()), replyTo, true
		}
		if label := buttonIDText(response.GetSelectedButtonID()); label != "" {
			return label, strings.TrimSpace(response.GetSelectedButtonID()), replyTo, true
		}
	}
	if response := m.GetTemplateButtonReplyMessage(); response != nil {
		if contextInfo := response.GetContextInfo(); contextInfo != nil {
			replyTo = contextInfo.GetStanzaID()
		}
		if label := strings.TrimSpace(response.GetSelectedDisplayText()); label != "" {
			return label, strings.TrimSpace(response.GetSelectedID()), replyTo, true
		}
		if label := buttonIDText(response.GetSelectedID()); label != "" {
			return label, strings.TrimSpace(response.GetSelectedID()), replyTo, true
		}
	}
	if response := m.GetListResponseMessage(); response != nil {
		if contextInfo := response.GetContextInfo(); contextInfo != nil {
			replyTo = contextInfo.GetStanzaID()
		}
		if label := strings.TrimSpace(response.GetTitle()); label != "" {
			actionID = ""
			if selected := response.GetSingleSelectReply(); selected != nil {
				actionID = strings.TrimSpace(selected.GetSelectedRowID())
			}
			return label, actionID, replyTo, true
		}
		if selected := response.GetSingleSelectReply(); selected != nil {
			if label := buttonIDText(selected.GetSelectedRowID()); label != "" {
				return label, strings.TrimSpace(selected.GetSelectedRowID()), replyTo, true
			}
		}
	}
	return "", "", "", false
}

func nativeFlowActionID(native *waProto.InteractiveResponseMessage_NativeFlowResponseMessage) string {
	if native == nil {
		return ""
	}
	var params struct {
		ID string `json:"id"`
	}
	if json.Unmarshal([]byte(native.GetParamsJSON()), &params) != nil {
		return ""
	}
	return strings.TrimSpace(params.ID)
}

func buttonIDText(id string) string {
	id = strings.TrimSpace(id)
	switch id {
	case "product_order":
		return "Pesan Sekarang"
	case "product_question":
		return "Tanya Detail"
	default:
		return id
	}
}

// SendImage mengunggah & mengirim gambar ke nomor.
func (w *waInstance) SendImage(toNumber, caption, mimetype string, data []byte) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}
	ctx := context.Background()
	up, err := client.Upload(ctx, data, whatsmeow.MediaImage)
	if err != nil {
		return fmt.Errorf("gagal upload gambar: %w", err)
	}
	_, err = client.SendMessage(ctx, types.NewJID(toNumber, types.DefaultUserServer), &waProto.Message{
		ImageMessage: &waProto.ImageMessage{
			Caption:       proto.String(caption),
			Mimetype:      proto.String(mimetype),
			URL:           proto.String(up.URL),
			DirectPath:    proto.String(up.DirectPath),
			MediaKey:      up.MediaKey,
			FileEncSHA256: up.FileEncSHA256,
			FileSHA256:    up.FileSHA256,
			FileLength:    proto.Uint64(up.FileLength),
		},
	})
	return err
}

// SendDocument mengunggah & mengirim file/dokumen ke nomor (caption opsional).
func (w *waInstance) SendDocument(toNumber, fileName, mimetype, caption string, data []byte) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}
	ctx := context.Background()
	up, err := client.Upload(ctx, data, whatsmeow.MediaDocument)
	if err != nil {
		return fmt.Errorf("gagal upload dokumen: %w", err)
	}
	_, err = client.SendMessage(ctx, types.NewJID(toNumber, types.DefaultUserServer), &waProto.Message{
		DocumentMessage: &waProto.DocumentMessage{
			FileName:      proto.String(fileName),
			Title:         proto.String(fileName),
			Caption:       proto.String(caption),
			Mimetype:      proto.String(mimetype),
			URL:           proto.String(up.URL),
			DirectPath:    proto.String(up.DirectPath),
			MediaKey:      up.MediaKey,
			FileEncSHA256: up.FileEncSHA256,
			FileSHA256:    up.FileSHA256,
			FileLength:    proto.Uint64(up.FileLength),
		},
	})
	return err
}

// SendVideo mengunggah & mengirim video ke nomor (caption opsional).
// Mengikuti pola whatsmeow: Upload(MediaVideo) lalu kirim VideoMessage dengan metadata hasil upload.
func (w *waInstance) SendVideo(toNumber, caption, mimetype string, data []byte) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}
	ctx := context.Background()
	up, err := client.Upload(ctx, data, whatsmeow.MediaVideo)
	if err != nil {
		return fmt.Errorf("gagal upload video: %w", err)
	}
	_, err = client.SendMessage(ctx, types.NewJID(toNumber, types.DefaultUserServer), &waProto.Message{
		VideoMessage: &waProto.VideoMessage{
			Caption:       proto.String(caption),
			Mimetype:      proto.String(mimetype),
			URL:           proto.String(up.URL),
			DirectPath:    proto.String(up.DirectPath),
			MediaKey:      up.MediaKey,
			FileEncSHA256: up.FileEncSHA256,
			FileSHA256:    up.FileSHA256,
			FileLength:    proto.Uint64(up.FileLength),
		},
	})
	return err
}

// PreparedMedia menyimpan hasil upload media SEKALI agar bisa dikirim ke banyak penerima
// tanpa upload ulang per penerima — penting untuk broadcast video/gambar besar.
type PreparedMedia struct {
	mediaType string // image, video, document
	mimetype  string
	fileName  string
	up        whatsmeow.UploadResponse
}

// PrepareMedia meng-upload media satu kali ke server WhatsApp; hasilnya dipakai SendPreparedMedia.
func (w *waInstance) PrepareMedia(mediaType, mimetype, fileName string, data []byte) (*PreparedMedia, error) {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return nil, fmt.Errorf("client WA tidak terhubung")
	}
	mt := whatsmeow.MediaDocument
	switch mediaType {
	case "image":
		mt = whatsmeow.MediaImage
	case "video":
		mt = whatsmeow.MediaVideo
	}
	up, err := client.Upload(context.Background(), data, mt)
	if err != nil {
		return nil, fmt.Errorf("gagal upload media: %w", err)
	}
	return &PreparedMedia{mediaType: mediaType, mimetype: mimetype, fileName: fileName, up: up}, nil
}

// SendPreparedMedia mengirim media yang sudah di-upload ke satu nomor (TANPA upload ulang).
func (w *waInstance) SendPreparedMedia(toNumber, caption string, pm *PreparedMedia) error {
	return w.sendPreparedMediaTo(types.NewJID(toNumber, types.DefaultUserServer), caption, pm)
}

// SendPreparedMediaToJID mengirim media yang sudah di-upload ke JID apa pun (grup "..@g.us").
func (w *waInstance) SendPreparedMediaToJID(jidStr, caption string, pm *PreparedMedia) error {
	jid, err := types.ParseJID(jidStr)
	if err != nil {
		return fmt.Errorf("JID tujuan tidak valid (%q): %w", jidStr, err)
	}
	return w.sendPreparedMediaTo(jid, caption, pm)
}

// sendPreparedMediaTo adalah inti pengiriman media ke satu JID (nomor atau grup).
func (w *waInstance) sendPreparedMediaTo(to types.JID, caption string, pm *PreparedMedia) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}
	up := pm.up
	var msg *waProto.Message
	switch pm.mediaType {
	case "image":
		msg = &waProto.Message{ImageMessage: &waProto.ImageMessage{
			Caption: proto.String(caption), Mimetype: proto.String(pm.mimetype),
			URL: proto.String(up.URL), DirectPath: proto.String(up.DirectPath), MediaKey: up.MediaKey,
			FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: proto.Uint64(up.FileLength),
		}}
	case "video":
		msg = &waProto.Message{VideoMessage: &waProto.VideoMessage{
			Caption: proto.String(caption), Mimetype: proto.String(pm.mimetype),
			URL: proto.String(up.URL), DirectPath: proto.String(up.DirectPath), MediaKey: up.MediaKey,
			FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: proto.Uint64(up.FileLength),
		}}
	default:
		msg = &waProto.Message{DocumentMessage: &waProto.DocumentMessage{
			FileName: proto.String(pm.fileName), Title: proto.String(pm.fileName),
			Caption: proto.String(caption), Mimetype: proto.String(pm.mimetype),
			URL: proto.String(up.URL), DirectPath: proto.String(up.DirectPath), MediaKey: up.MediaKey,
			FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: proto.Uint64(up.FileLength),
		}}
	}
	_, err := client.SendMessage(context.Background(), to, msg)
	return err
}

// Suspend memutus socket WA tanpa menghapus sesi (device tetap tersimpan di store).
// Dipakai saat langganan tenant tidak aktif; cukup Connect() lagi untuk menyambung tanpa scan QR.
func (w *waInstance) Suspend() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.client != nil {
		w.client.Disconnect()
		w.client = nil
	}
	w.qrCode = ""
	w.status = "disconnected"
}

func (w *waInstance) SendMessage(to types.JID, message string, replyToID ...string) error {
	return w.sendMessageWithDelay(to, message, humanDelay(message), replyToID...)
}

// MarkIncomingRead mengirim read receipt untuk pesan yang benar-benar akan dibalas.
// Ini terpisah dari AutoRead: AutoRead membaca saat pesan tiba, sedangkan fungsi ini
// dipanggil pipeline balasan tepat sebelum indikator mengetik atau balasan dikirim.
func (w *waInstance) MarkIncomingRead(chat, sender types.JID, rawIDs []string) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}
	if chat.IsEmpty() || sender.IsEmpty() || len(rawIDs) == 0 {
		return nil
	}
	ids := make([]types.MessageID, 0, len(rawIDs))
	seen := map[string]bool{}
	for _, rawID := range rawIDs {
		rawID = strings.TrimSpace(rawID)
		if rawID == "" || seen[rawID] {
			continue
		}
		seen[rawID] = true
		ids = append(ids, types.MessageID(rawID))
	}
	if len(ids) == 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return client.MarkRead(ctx, ids, time.Now(), chat, sender)
}

// SendMessageWithDelay mengirim balasan Alur Otomatis dengan rentang jeda yang
// dipilih user. Jeda ini menggantikan humanDelay default, jadi tidak ditumpuk dua kali.
func (w *waInstance) SendMessageWithDelay(to types.JID, message string, minSeconds, maxSeconds int) error {
	return w.SendMessageWithDelayGuarded(to, message, minSeconds, maxSeconds, nil)
}

// SendMessageWithDelayGuarded memeriksa ulang guard setelah indikator mengetik.
// Ini mencegah balasan AI terkirim bila admin mengambil alih saat AI sedang menunggu.
func (w *waInstance) SendMessageWithDelayGuarded(to types.JID, message string, minSeconds, maxSeconds int, guard func() bool) error {
	if minSeconds < 0 {
		minSeconds = 0
	}
	if minSeconds > 30 {
		minSeconds = 30
	}
	if maxSeconds > 30 {
		maxSeconds = 30
	}
	if maxSeconds < minSeconds {
		maxSeconds = minSeconds
	}
	delaySeconds := minSeconds
	if maxSeconds > minSeconds {
		delaySeconds += rand.Intn(maxSeconds - minSeconds + 1)
	}
	delay := time.Duration(delaySeconds) * time.Second
	if guard != nil && !guard() {
		return nil
	}
	if delay > 0 {
		w.mu.Lock()
		client := w.client
		w.mu.Unlock()
		if client == nil || !client.IsConnected() {
			return fmt.Errorf("client WA tidak terhubung")
		}
		ctx := context.Background()
		_ = client.SendPresence(ctx, types.PresenceAvailable)
		_ = client.SendChatPresence(ctx, to, types.ChatPresenceComposing, types.ChatPresenceMediaText)
		time.Sleep(delay)
		_ = client.SendChatPresence(ctx, to, types.ChatPresencePaused, types.ChatPresenceMediaText)
		if guard != nil && !guard() {
			return nil
		}
		return w.sendMessageWithDelay(to, message, 0)
	}
	return w.sendMessageWithDelay(to, message, 0)
}

func (w *waInstance) sendMessageWithDelay(to types.JID, message string, delay time.Duration, replyToID ...string) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}

	ctx := context.Background()
	// Humanisasi: tampilkan "mengetik..." selama jeda, lalu kirim.
	_ = client.SendPresence(ctx, types.PresenceAvailable)
	if delay > 0 {
		_ = client.SendChatPresence(ctx, to, types.ChatPresenceComposing, types.ChatPresenceMediaText)
		time.Sleep(delay)
		_ = client.SendChatPresence(ctx, to, types.ChatPresencePaused, types.ChatPresenceMediaText)
	}

	msg := &waProto.Message{
		Conversation: proto.String(message),
	}
	// Reply native: gunakan ExtendedTextMessage dengan ContextInfo.
	if len(replyToID) > 0 && replyToID[0] != "" {
		msg = &waProto.Message{
			ExtendedTextMessage: &waProto.ExtendedTextMessage{
				Text: proto.String(message),
				ContextInfo: &waProto.ContextInfo{
					StanzaID:    proto.String(replyToID[0]),
					Participant: proto.String(to.ToNonAD().String()),
				},
			},
		}
	}
	_, err := client.SendMessage(ctx, to, msg)
	return err
}

// SendTextAndGetID mengirim teks dan mengembalikan ID pesan WhatsApp (untuk revoke).
func (w *waInstance) SendTextAndGetID(toNumber, message string) (string, error) {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return "", fmt.Errorf("client WA tidak terhubung")
	}
	jid := types.NewJID(toNumber, types.DefaultUserServer)
	ctx := context.Background()
	_ = client.SendPresence(ctx, types.PresenceAvailable)
	_ = client.SendChatPresence(ctx, jid, types.ChatPresenceComposing, types.ChatPresenceMediaText)
	time.Sleep(humanDelay(message))
	_ = client.SendChatPresence(ctx, jid, types.ChatPresencePaused, types.ChatPresenceMediaText)
	resp, err := client.SendMessage(ctx, jid, &waProto.Message{Conversation: proto.String(message)})
	if err != nil {
		return "", err
	}
	return resp.ID, nil
}

// humanDelay meniru kecepatan mengetik manusia: jeda dasar acak + proporsional panjang pesan, dibatasi 6 detik.
func humanDelay(msg string) time.Duration {
	ms := 1500 + rand.Intn(1500) + len([]rune(msg))*25
	if ms > 6000 {
		ms = 6000
	}
	return time.Duration(ms) * time.Millisecond
}

// PostStatus memposting WhatsApp Status (Story) — satu postingan 24 jam yang dilihat kontak.
func (w *waInstance) PostStatus(text, mimetype string, media []byte) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}
	ctx := context.Background()
	var msg *waProto.Message
	if len(media) > 0 {
		up, err := client.Upload(ctx, media, whatsmeow.MediaImage)
		if err != nil {
			return fmt.Errorf("gagal upload gambar status: %w", err)
		}
		msg = &waProto.Message{ImageMessage: &waProto.ImageMessage{
			Caption:       proto.String(text),
			Mimetype:      proto.String(mimetype),
			URL:           proto.String(up.URL),
			DirectPath:    proto.String(up.DirectPath),
			MediaKey:      up.MediaKey,
			FileEncSHA256: up.FileEncSHA256,
			FileSHA256:    up.FileSHA256,
			FileLength:    proto.Uint64(up.FileLength),
		}}
	} else {
		if strings.TrimSpace(text) == "" {
			return fmt.Errorf("status kosong")
		}
		msg = &waProto.Message{ExtendedTextMessage: &waProto.ExtendedTextMessage{Text: proto.String(text)}}
	}
	_, err := client.SendMessage(ctx, types.StatusBroadcastJID, msg)
	return err
}

// SendContact mengirim kartu kontak (vCard) — dipakai broadcast "simpan kontak kami".
func (w *waInstance) SendContact(toNumber, text, displayName, number string) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}
	jid := types.NewJID(toNumber, types.DefaultUserServer)
	ctx := context.Background()
	msg := &waProto.Message{
		ExtendedTextMessage: &waProto.ExtendedTextMessage{
			Text: proto.String(text),
		},
	}
	if displayName != "" && number != "" {
		msg.ContactMessage = &waProto.ContactMessage{
			DisplayName: proto.String(displayName),
			Vcard:       proto.String(buildVCard(displayName, number)),
		}
	}
	_, err := client.SendMessage(ctx, jid, msg)
	return err
}

// buildVCard menyusun vCard 3.0 minimal yang dikenali WhatsApp.
func buildVCard(name, number string) string {
	digits := digitsOnly(number)
	return "BEGIN:VCARD\n" +
		"VERSION:3.0\n" +
		"N:;" + name + ";;;\n" +
		"FN:" + name + "\n" +
		"TEL;type=CELL;type=VOICE;waid=" + digits + ":+" + digits + "\n" +
		"END:VCARD"
}

// digitsOnly menyaring string menjadi hanya angka.
type ReplyButton struct {
	ID   string
	Text string
}

// SendButtonsWithDelay menjaga pengalaman Alur Otomatis konsisten: read receipt
// dikirim oleh handler, lalu indikator mengetik tampil selama jeda sebelum tombol.
func (w *waInstance) SendButtonsWithDelay(toNumber, bodyText, footerText string, buttons []ReplyButton, minSeconds, maxSeconds int) error {
	if minSeconds < 0 {
		minSeconds = 0
	}
	if minSeconds > 30 {
		minSeconds = 30
	}
	if maxSeconds > 30 {
		maxSeconds = 30
	}
	if maxSeconds < minSeconds {
		maxSeconds = minSeconds
	}
	delaySeconds := minSeconds
	if maxSeconds > minSeconds {
		delaySeconds += rand.Intn(maxSeconds - minSeconds + 1)
	}
	to := types.NewJID(toNumber, types.DefaultUserServer)
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}
	ctx := context.Background()
	_ = client.SendPresence(ctx, types.PresenceAvailable)
	if delaySeconds > 0 {
		_ = client.SendChatPresence(ctx, to, types.ChatPresenceComposing, types.ChatPresenceMediaText)
		time.Sleep(time.Duration(delaySeconds) * time.Second)
		_ = client.SendChatPresence(ctx, to, types.ChatPresencePaused, types.ChatPresenceMediaText)
	}
	return w.SendButtons(toNumber, bodyText, footerText, buttons)
}

// SendButtons mengirim pesan interaktif dengan tombol via NativeFlowMessage (modern API).
func (w *waInstance) SendButtons(toNumber, bodyText, footerText string, buttons []ReplyButton) error {
	w.mu.Lock()
	client := w.client
	w.mu.Unlock()
	if client == nil || !client.IsConnected() {
		return fmt.Errorf("client WA tidak terhubung")
	}

	to := types.NewJID(toNumber, types.DefaultUserServer)

	btnList := make([]*waProto.InteractiveMessage_NativeFlowMessage_NativeFlowButton, 0, len(buttons))
	for _, b := range buttons {
		params, err := json.Marshal(map[string]string{"display_text": b.Text, "id": b.ID})
		if err != nil {
			return fmt.Errorf("gagal menyusun tombol: %w", err)
		}
		btnList = append(btnList, &waProto.InteractiveMessage_NativeFlowMessage_NativeFlowButton{
			Name:             proto.String("quick_reply"),
			ButtonParamsJSON: proto.String(string(params)),
		})
	}

	msg := &waProto.Message{
		InteractiveMessage: &waProto.InteractiveMessage{
			Header: &waProto.InteractiveMessage_Header{
				HasMediaAttachment: proto.Bool(false),
			},
			Body:   &waProto.InteractiveMessage_Body{Text: proto.String(bodyText)},
			Footer: &waProto.InteractiveMessage_Footer{Text: proto.String(footerText)},
			InteractiveMessage: &waProto.InteractiveMessage_NativeFlowMessage_{
				NativeFlowMessage: &waProto.InteractiveMessage_NativeFlowMessage{
					MessageVersion: proto.Int32(3),
					Buttons:        btnList,
				},
			},
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	additionalNodes := nativeFlowBizNodes()
	_, err := client.SendMessage(ctx, to, msg, whatsmeow.SendRequestExtra{AdditionalNodes: &additionalNodes})
	return err
}

// nativeFlowBizNodes memberi tahu server WhatsApp bahwa payload ini adalah
// interactive native-flow. whatsmeow menambahkan node bisnis otomatis untuk
// ButtonsMessage lama, tetapi belum mendeteksi InteractiveMessage modern.
func nativeFlowBizNodes() []waBinary.Node {
	return []waBinary.Node{{
		Tag: "biz",
		Content: []waBinary.Node{{
			Tag: "interactive",
			Attrs: waBinary.Attrs{
				"type": "native_flow",
				"v":    "1",
			},
			Content: []waBinary.Node{{
				Tag: "native_flow",
				Attrs: waBinary.Attrs{
					"name": "mixed",
					"v":    "9",
				},
			}},
		}},
	}}
}

func digitsOnly(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, s)
}
