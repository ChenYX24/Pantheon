package chat

import (
	"context"
	"encoding/json"
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
		row, cfg, err := b.ReadChannel(ctx, "feishu")
		if err != nil {
			return err
		}
		if !row.Enabled {
			return errors.New("Feishu notification channel is disabled")
		}
		factory, ok := FactoryFor("feishu")
		if !ok {
			return errors.New("Feishu adapter is unavailable")
		}
		values, err := json.Marshal(cfg.Values)
		if err != nil {
			return err
		}
		adapter, err := factory.New(values, Env{HTTP: b.d.HTTP, State: cfg.State, PublicURL: b.d.PublicURL()})
		if err != nil {
			return err
		}
		// An explicit send in development must not start the bridge's inbound
		// loop. Feishu can send without Run; keep this adapter off the channel
		// map too, so no webhook can acquire it as a side effect of a notice.
		ch = &channel{kind: "feishu", ad: adapter, caps: adapter.Capabilities()}
	}
	_, err = b.send(ctx, ch, p, Outbound{Text: text})
	return err
}
