package chat

import (
	"context"
	"errors"

	"github.com/jiangmuran/vibepanel/internal/store"
)

func HomeKindLabel(lang, kind string) string { return msg(lang, "home."+kind) }

// Home notifications are plain outbound text. They carry no workflow decision
// ids or buttons, so answering one cannot approve or execute project work.
func (b *Bridge) SendHomeNotification(ctx context.Context, peer, text string) error {
	p, err := b.d.DB.GetChatPeer(ctx, "feishu", peer)
	if err != nil || p.Status != store.PeerPaired {
		return errors.New("Feishu recipient is not paired")
	}
	b.mu.Lock()
	ch := b.chans["feishu"]
	b.mu.Unlock()
	if ch == nil || ch.placeholder {
		return errors.New("Feishu notification channel is not running")
	}
	_, err = b.send(ctx, ch, p, Outbound{Text: text})
	return err
}
