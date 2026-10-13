package chat

import (
	"context"
	"fmt"
	"strings"

	"github.com/jiangmuran/vibepanel/internal/store"
)

// An attachment is a file a session sends (docs/cli.md, `vibepanel me
// send`): a chart it drew, a report it wrote. An image goes to the phone as
// an image, with the caption; anything else goes as a card naming the file
// with a link into the panel, where the signed-in owner downloads it. The
// link is not a door: the attachment route is under the session cookie.

// imageType reports whether the phone's adapters can show this as a photo.
func imageType(contentType string) bool {
	switch strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0])) {
	case "image/png", "image/jpeg", "image/gif", "image/webp":
		return true
	}
	return false
}

// SendAttachment delivers a file to every paired contact the routes name,
// and returns how many got it.
func (b *Bridge) SendAttachment(ctx context.Context, row store.Session, name string, data []byte, contentType, caption, url string) int {
	if row.ArchivedAt != nil || len(data) == 0 {
		return 0
	}
	raw, _ := b.d.DB.GetSetting(ctx, RoutesKey, "")
	d := ParseRoutes(raw).Decide(Change{SessionID: row.ID, ProjectID: row.ProjectID, State: string(row.State), Kind: store.MessageNotice}, b.d.Now().In(b.d.Zone()))
	if d.Hold {
		b.d.Audit(ctx, "chat.held", fmt.Sprintf("attachment from %s held by quiet hours", row.Title))
		return 0
	}
	peers, err := b.d.DB.PairedChatPeers(ctx)
	if err != nil {
		return 0
	}
	handle, err := b.Handle(ctx, row.ID)
	if err != nil {
		return 0
	}
	project := ""
	if p, perr := b.d.DB.GetProject(ctx, row.ProjectID); perr == nil {
		project = p.Name
	}
	lang := b.language()
	label := caption
	if label == "" {
		label = name
	}
	sent := 0
	now := b.d.Now().Unix()
	for _, p := range peers {
		ch, ok := b.channel(p.Channel)
		if !ok {
			continue
		}
		if d.Send && !Destined(d.To, p.Channel, p.PeerID) {
			continue
		}
		if until, _ := b.d.DB.ChatMutedUntil(ctx, p.Channel, p.PeerID, row.ID, now); until > 0 {
			continue
		}
		if !ch.caps.Proactive && p.ContextToken == "" {
			b.undelivered(ctx, ch, p, row.ID, string(row.State), ErrNeedsHello)
			continue
		}
		var ref string
		if imageType(contentType) && ch.caps.Images {
			ref, err = ch.ad.SendImage(ctx, Peer{ID: p.PeerID, ContextToken: p.ContextToken}, data, fmt.Sprintf("[%d] %s · %s", handle, row.Title, label))
		} else {
			body := label
			if caption != "" {
				body = caption + "\n" + name
			}
			body += fmt.Sprintf(" (%s)", humanSize(len(data)))
			if url != "" {
				body += "\n" + url
			}
			card := &Card{Handle: handle, Title: row.Title, Project: project, State: string(row.State),
				Glyph: "📎", StateText: pick(lang, "发来文件", "sent a file"), Body: body}
			ref, err = b.send(ctx, ch, p, Outbound{Card: card})
		}
		if err != nil {
			b.undelivered(ctx, ch, p, row.ID, string(row.State), err)
			continue
		}
		_ = b.d.DB.RecordChatOutbound(ctx, store.ChatOutbound{Channel: p.Channel, PeerID: p.PeerID, Ref: ref, SessionID: row.ID, Kind: store.OutboundStatus})
		sent++
	}
	b.d.Audit(ctx, "chat.attach", fmt.Sprintf("[%d] %s: %s (%d bytes) → %d contact(s)", handle, row.Title, name, len(data), sent))
	return sent
}

func humanSize(n int) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/float64(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%d KB", n/(1<<10))
	}
	return fmt.Sprintf("%d B", n)
}
