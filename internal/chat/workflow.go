package chat

import (
	"context"
	"errors"
	"strings"

	"github.com/jiangmuran/vibepanel/internal/store"
)

// Only the already-paired peer can decide a durable plan request. Ordinary
// "ok" messages keep their existing meaning and never authorize a project plan.
func (b *Bridge) workflowDecision(ctx context.Context, ch *channel, peer store.ChatPeer, in Inbound) bool {
	value := ""
	if in.Action != nil {
		value = in.Action.Value
	} else {
		parts := strings.Fields(in.Text)
		if len(parts) == 2 {
			if parts[0] == "确认计划" {
				value = "plan:confirm:" + parts[1]
			} else if parts[0] == "拒绝计划" {
				value = "plan:reject:" + parts[1]
			}
		}
	}
	if !strings.HasPrefix(value, "plan:") {
		return false
	}
	parts := strings.Split(value, ":")
	if len(parts) != 3 || (parts[1] != "confirm" && parts[1] != "reject") {
		return true
	}
	err := b.d.DB.DecideWorkflowNotice(ctx, parts[2], peer.Channel, peer.PeerID, parts[1] == "confirm")
	text := "计划确认已记录，面板与其他通知渠道使用同一份阶段授权。"
	if err != nil {
		text = "计划未执行：" + err.Error()
	}
	b.reply(ctx, ch, peer, text)
	return true
}
func (b *Bridge) SendWorkflowNotice(ctx context.Context, n store.WorkflowNotice) error {
	p, err := b.d.DB.GetChatPeer(ctx, n.Channel, n.PeerID)
	if err != nil || p.Status != store.PeerPaired {
		return errors.New("recipient is not paired")
	}
	b.mu.Lock()
	ch := b.chans[n.Channel]
	b.mu.Unlock()
	if ch == nil {
		return errors.New("notification channel is not running")
	}
	text := n.Text + "\n\n确认：确认计划 " + n.ID + "\n拒绝：拒绝计划 " + n.ID + "\n详情：" + strings.TrimRight(b.d.PublicURL(), "/") + "/projects?project=" + n.ProjectID
	out := Outbound{Text: text}
	if ch.caps.Buttons {
		out = Outbound{Card: &Card{Title: "项目阶段确认", Project: n.ProjectID, State: "waiting", Glyph: "▲", StateText: "待确认", Body: text}, Buttons: []Button{{Label: "确认阶段", Value: "plan:confirm:" + n.ID}, {Label: "拒绝", Value: "plan:reject:" + n.ID, Danger: true}}}
	}
	_, err = b.send(ctx, ch, p, out)
	return err
}
