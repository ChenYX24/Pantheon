package httpapi

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/go-chi/chi/v5"
)

// Attachments: a file a session sends (docs/cli.md, `vibepanel me send`)
// or the owner attaches to it. Kept under <data>/sessions/<id>/attachments,
// the newest twenty, sixteen megabytes each and a hundred an hour per
// session; served to the signed-in owner, images inline and everything
// else as a download, HTML and SVG included -- the same rule as a plugin
// process's answers, for the same reason. The phone gets an image as a
// photo and anything else as a card with the download link, which is not
// a door: the route is under the session cookie.

const (
	attachmentMaxBytes  = 16 << 20
	attachmentKeep      = 20
	attachmentHourBytes = int64(100) << 20
)

type attachmentRow struct {
	Name     string `json:"name"`
	Bytes    int64  `json:"bytes"`
	Size     string `json:"size"`
	URL      string `json:"url"`
	At       int64  `json:"at"`
	Contacts int    `json:"contacts"`
}

func (s *Server) registerAttachmentRoutes(r chi.Router) {
	r.Post("/sessions/{id}/attach", s.handleSessionAttach)
	r.Get("/sessions/{id}/attachments", s.handleListAttachments)
	r.Get("/sessions/{id}/attachments/{name}", s.handleGetAttachment)
}

func (s *Server) attachmentsDir(sessionID string) string {
	return filepath.Join(s.Cfg.DataDir, "sessions", sessionID, "attachments")
}

func (s *Server) attachmentURL(sessionID, name string) string {
	base := strings.TrimRight(s.Cfg.PublicURL(), "/")
	if base == "" {
		base = strings.TrimRight(s.Cfg.LoopbackURL(), "/")
	}
	return base + "/api/sessions/" + sessionID + "/attachments/" + name
}

// safeAttachmentName keeps a filename's letters, digits, dots, dashes and
// underscores, so what lands on disk is what the URL names and nothing
// else; a name with nothing usable becomes "file".
func safeAttachmentName(raw string) string {
	base := filepath.Base(filepath.FromSlash(raw))
	var b strings.Builder
	for _, r := range base {
		switch {
		case unicode.IsLetter(r), unicode.IsDigit(r), r == '.', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	name := strings.Trim(b.String(), "._")
	if name == "" || len(name) > 120 {
		if len(name) > 120 {
			name = name[len(name)-120:]
		} else {
			name = "file"
		}
	}
	return name
}

// renderableAttachment is what may be shown inline on the panel's origin:
// raster images, audio, video, plain text. Not HTML, not SVG, not XML.
func renderableAttachment(ct string) bool {
	return renderablePluginType(ct) && !strings.HasPrefix(ct, "application/json")
}

func (s *Server) handleSessionAttach(w http.ResponseWriter, r *http.Request) {
	row, by, ok := s.noticeSubject(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	r.Body = http.MaxBytesReader(w, r.Body, attachmentMaxBytes+64<<10)
	reader, err := r.MultipartReader()
	if err != nil {
		writeErr(w, http.StatusBadRequest, "expected a multipart upload with a file")
		return
	}
	caption, name := "", ""
	var data []byte
	for {
		part, perr := reader.NextPart()
		if errors.Is(perr, io.EOF) {
			break
		}
		if perr != nil {
			writeErr(w, http.StatusBadRequest, "malformed upload: "+perr.Error())
			return
		}
		switch {
		case part.FormName() == "caption":
			raw, _ := io.ReadAll(io.LimitReader(part, 2048))
			caption = strings.TrimSpace(string(raw))
		case part.FormName() == "file" && part.FileName() != "" && data == nil:
			name = safeAttachmentName(part.FileName())
			raw, rerr := io.ReadAll(io.LimitReader(part, attachmentMaxBytes+1))
			if rerr != nil {
				part.Close()
				writeErr(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("a file is at most %d MiB", attachmentMaxBytes>>20))
				return
			}
			if len(raw) > attachmentMaxBytes {
				part.Close()
				writeErr(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("a file is at most %d MiB", attachmentMaxBytes>>20))
				return
			}
			data = raw
		}
		part.Close()
	}
	if data == nil {
		writeErr(w, http.StatusBadRequest, "no file in the upload")
		return
	}
	if r := []rune(caption); len(r) > 200 {
		caption = string(r[:200])
	}
	if retry, ok := s.attachmentAdmit(row.ID, int64(len(data))); !ok {
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		writeErr(w, http.StatusTooManyRequests, "this session has sent enough bytes for an hour")
		return
	}
	dir := s.attachmentsDir(row.ID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// A second file of the same name gets a numbered name rather than
	// replacing the first: the link already sent still points at it.
	final := name
	for i := 2; ; i++ {
		if _, err := os.Stat(filepath.Join(dir, final)); err != nil {
			break
		}
		ext := filepath.Ext(name)
		final = strings.TrimSuffix(name, ext) + "-" + strconv.Itoa(i) + ext
	}
	if err := os.WriteFile(filepath.Join(dir, final), data, 0o600); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.pruneAttachments(dir)
	ct := http.DetectContentType(data)
	if byExt := mime.TypeByExtension(filepath.Ext(final)); strings.HasPrefix(ct, "application/octet-stream") && byExt != "" {
		ct = byExt
	}
	url := s.attachmentURL(row.ID, final)
	contacts := 0
	if s.Chat != nil {
		contacts = s.Chat.SendAttachment(ctx, row, final, data, ct, caption, url)
	}
	text := caption
	if text == "" {
		text = final
	}
	s.broadcastNoticeURL(ctx, row, "file", text, url)
	s.audit(ctx, "session.sent", by, s.clientIP(r), fmt.Sprintf("%s: %s (%d bytes) to %d contact(s)", row.ID, final, len(data), contacts))
	writeJSON(w, http.StatusCreated, attachmentRow{Name: final, Bytes: int64(len(data)), Size: humanBytesShort(int64(len(data))), URL: url, At: time.Now().Unix(), Contacts: contacts})
}

// attachmentAdmit is the hourly byte budget per session.
func (s *Server) attachmentAdmit(sessionID string, n int64) (int, bool) {
	st := &s.ntc
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.bytes == nil {
		st.bytes = map[string][]byteStamp{}
	}
	now := time.Now()
	recent := st.bytes[sessionID][:0]
	var total int64
	for _, b := range st.bytes[sessionID] {
		if now.Sub(b.at) < time.Hour {
			recent = append(recent, b)
			total += b.n
		}
	}
	if total+n > attachmentHourBytes {
		st.bytes[sessionID] = recent
		retry := 3600
		if len(recent) > 0 {
			retry = int((time.Hour - now.Sub(recent[0].at)).Seconds()) + 1
		}
		return retry, false
	}
	st.bytes[sessionID] = append(recent, byteStamp{at: now, n: n})
	return 0, true
}

type byteStamp struct {
	at time.Time
	n  int64
}

// pruneAttachments keeps the newest attachmentKeep files.
func (s *Server) pruneAttachments(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) <= attachmentKeep {
		return
	}
	type aged struct {
		name string
		at   time.Time
	}
	var list []aged
	for _, e := range entries {
		if info, err := e.Info(); err == nil && !e.IsDir() {
			list = append(list, aged{e.Name(), info.ModTime()})
		}
	}
	sort.Slice(list, func(i, j int) bool { return list[i].at.After(list[j].at) })
	for _, a := range list[attachmentKeep:] {
		_ = os.Remove(filepath.Join(dir, a.name))
	}
}

func (s *Server) listAttachments(sessionID string) []attachmentRow {
	out := []attachmentRow{}
	entries, err := os.ReadDir(s.attachmentsDir(sessionID))
	if err != nil {
		return out
	}
	for _, e := range entries {
		info, err := e.Info()
		if err != nil || e.IsDir() {
			continue
		}
		out = append(out, attachmentRow{Name: e.Name(), Bytes: info.Size(), Size: humanBytesShort(info.Size()),
			URL: s.attachmentURL(sessionID, e.Name()), At: info.ModTime().Unix()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].At > out[j].At })
	return out
}

func (s *Server) handleListAttachments(w http.ResponseWriter, r *http.Request) {
	row, err := s.DB.GetSession(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.listAttachments(row.ID))
}

func (s *Server) handleGetAttachment(w http.ResponseWriter, r *http.Request) {
	row, err := s.DB.GetSession(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	name := chi.URLParam(r, "name")
	if name != safeAttachmentName(name) {
		http.NotFound(w, r)
		return
	}
	path := filepath.Join(s.attachmentsDir(row.ID), name)
	data, err := os.ReadFile(path) //nolint:gosec // under the session's own directory, name checked
	if err != nil {
		http.NotFound(w, r)
		return
	}
	ct := http.DetectContentType(data)
	if byExt := mime.TypeByExtension(filepath.Ext(name)); strings.HasPrefix(ct, "application/octet-stream") && byExt != "" {
		ct = byExt
	}
	h := w.Header()
	h.Set("Content-Type", ct)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "private, no-store")
	if !renderableAttachment(ct) {
		h.Set("Content-Security-Policy", "sandbox")
		h.Set("Content-Disposition", "attachment; filename=\""+name+"\"")
	}
	h.Set("Content-Length", strconv.Itoa(len(data)))
	_, _ = w.Write(data)
}

func humanBytesShort(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/float64(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%d KB", n/(1<<10))
	}
	return fmt.Sprintf("%d B", n)
}
