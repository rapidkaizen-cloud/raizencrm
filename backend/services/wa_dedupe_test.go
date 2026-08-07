package services

import (
	"testing"

	"go.mau.fi/whatsmeow/types"
)

// Satu pesan yang dikirim ulang server (alamat LID & alamat nomor telepon) hanya boleh
// lolos sekali — ini yang mencegah customer menerima balasan dobel.
func TestMarkIncomingSeenMenolakPesanGanda(t *testing.T) {
	const id types.MessageID = "AC1D4B0440A3A0454C66E793372E6ACB"
	if !markIncomingSeen(1, id) {
		t.Fatal("kiriman pertama harus diproses")
	}
	if markIncomingSeen(1, id) {
		t.Fatal("kiriman kedua dengan ID sama harus diabaikan")
	}
}

// Agent berbeda punya sesi WA sendiri; ID pesan yang kebetulan sama tidak boleh
// saling membatalkan.
func TestMarkIncomingSeenTerpisahPerAgent(t *testing.T) {
	const id types.MessageID = "ACC204C93B6A1824493A6243A2B6306D"
	if !markIncomingSeen(1, id) {
		t.Fatal("agent 1 harus memproses pesannya")
	}
	if !markIncomingSeen(2, id) {
		t.Fatal("agent 2 harus tetap memproses pesannya sendiri")
	}
}

// Pesan tanpa ID tidak punya dasar pembanding, jadi jangan sampai terbuang.
func TestMarkIncomingSeenMeloloskanIDKosong(t *testing.T) {
	if !markIncomingSeen(1, "") {
		t.Fatal("pesan tanpa ID harus tetap diproses")
	}
	if !markIncomingSeen(1, "") {
		t.Fatal("pesan tanpa ID tidak boleh ikut tersaring")
	}
}

// resolvePN: alamat nomor telepon biasa dipakai apa adanya, dan alamat LID diganti
// nomor asli dari event bila tersedia.
func TestResolvePNMemakaiAlamatAlternatif(t *testing.T) {
	w := &waInstance{agentID: 1}
	pn := types.NewJID("6281369281534", types.DefaultUserServer)
	lid := types.NewJID("179465393074395", types.HiddenUserServer)

	if got := w.resolvePN(pn, types.EmptyJID); got != pn {
		t.Fatalf("resolvePN(nomor) = %s, want %s", got, pn)
	}
	if got := w.resolvePN(lid, pn); got != pn {
		t.Fatalf("resolvePN(LID, alt) = %s, want %s", got, pn)
	}
	// Tanpa alamat alternatif dan tanpa client (store belum siap), LID dibiarkan apa
	// adanya supaya pesannya tetap terlayani — perapiannya lewat sapuan LID berkala.
	if got := w.resolvePN(lid, types.EmptyJID); got != lid {
		t.Fatalf("resolvePN(LID, kosong) = %s, want %s", got, lid)
	}
}
