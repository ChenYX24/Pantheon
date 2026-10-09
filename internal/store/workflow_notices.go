package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jiangmuran/vibepanel/internal/id"
)

type WorkflowNotice struct {
	ID            string `json:"id"`
	ProjectID     string `json:"projectId"`
	StageID       string `json:"stageId"`
	Revision      int64  `json:"revision"`
	Digest        string `json:"digest"`
	Channel       string `json:"channel"`
	PeerID        string `json:"peerId"`
	Text          string `json:"text"`
	State         string `json:"state"`
	ExpiresAt     int64  `json:"expiresAt"`
	Attempts      int    `json:"attempts"`
	NextAttemptAt int64  `json:"nextAttemptAt"`
	LastError     string `json:"lastError"`
}

func (d *DB) QueueWorkflowNotice(ctx context.Context, n WorkflowNotice) (WorkflowNotice, error) {
	b, err := d.GetProjectBoard(ctx, n.ProjectID)
	if err != nil {
		return n, err
	}
	if n.Revision != b.Rev {
		return n, ErrBoardStale
	}
	peer, err := d.GetChatPeer(ctx, n.Channel, n.PeerID)
	if err != nil || peer.Status != PeerPaired {
		return n, errors.New("recipient must be paired")
	}
	found := false
	for _, s := range b.Stages {
		if s.ID == n.StageID {
			found = true
			n.Text = fmt.Sprintf("阶段确认：%s\n计划版本：%d\n主：%s / %s\n辅：%s / %s\n预算：%d 分钟；每次 %d 分钟，最多 %d 次\n%s", s.Title, b.Rev, s.Primary.Harness, s.Primary.Model, s.Secondary.Harness, s.Secondary.Model, s.BudgetMinutes, s.AttemptMinutes, s.MaxAttempts, s.Reason)
		}
	}
	if !found {
		return n, ErrNotFound
	}
	for _, t := range b.Tasks {
		if t.Phase == n.StageID {
			n.Text += "\n任务：" + t.Title + "\n验收：" + t.Acceptance
			for _, command := range t.Verify {
				n.Text += "\n执行检查：" + command
			}
		}
	}
	if len(n.Text) > 12000 {
		return n, errors.New("stage too large for a confirmation message; confirm it in the panel")
	}
	n.ID = id.New()
	n.Digest = StageDigest(b, n.StageID)
	n.State = "pending"
	n.ExpiresAt = now() + 86400
	key := fmt.Sprintf("%s:%s:%d:%s:%s", n.ProjectID, n.StageID, n.Revision, n.Channel, n.PeerID)
	_, err = d.sql.ExecContext(ctx, `INSERT INTO pm_deliveries VALUES(?,?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING`, n.ID, n.ProjectID, key, n.State, mustJSON(n), now())
	// Six table columns; keep the serialized notice as the single delivery payload.
	if err != nil {
		return n, err
	}
	var raw, state string
	err = d.sql.QueryRowContext(ctx, `SELECT content,state FROM pm_deliveries WHERE event_id=?`, key).Scan(&raw, &state)
	if err != nil {
		return n, err
	}
	err = json.Unmarshal([]byte(raw), &n)
	n.State = state
	return n, err
}
func (d *DB) WorkflowNotices(ctx context.Context, pid string) ([]WorkflowNotice, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT content,state FROM pm_deliveries WHERE (?='' OR project_id=?) ORDER BY created_at DESC LIMIT 200`, pid, pid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WorkflowNotice{}
	for rows.Next() {
		var raw, state string
		var n WorkflowNotice
		if err = rows.Scan(&raw, &state); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(raw), &n); err != nil {
			return nil, err
		}
		n.State = state
		out = append(out, n)
	}
	return out, rows.Err()
}
func (d *DB) UpdateWorkflowNotice(ctx context.Context, n WorkflowNotice) error {
	_, err := d.sql.ExecContext(ctx, `UPDATE pm_deliveries SET content=?,state=? WHERE id=? AND state NOT IN ('confirmed','rejected')`, mustJSON(n), n.State, n.ID)
	return err
}
func (d *DB) DecideWorkflowNotice(ctx context.Context, nid, channel, peer string, approve bool) error {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE pm_deliveries SET state=state WHERE id=?`, nid); err != nil {
		return err
	}
	var raw, state string
	if err = tx.QueryRowContext(ctx, `SELECT content,state FROM pm_deliveries WHERE id=?`, nid).Scan(&raw, &state); err != nil {
		return ErrNotFound
	}
	var n WorkflowNotice
	if err = json.Unmarshal([]byte(raw), &n); err != nil {
		return err
	}
	if n.Channel != channel || n.PeerID != peer {
		return errors.New("this confirmation belongs to another recipient")
	}
	var status string
	if err = tx.QueryRowContext(ctx, `SELECT status FROM chat_peers WHERE channel=? AND peer_id=?`, channel, peer).Scan(&status); err != nil || status != string(PeerPaired) {
		return errors.New("recipient is no longer paired")
	}
	if (state == "confirmed" && approve) || (state == "rejected" && !approve) {
		return tx.Commit()
	}
	if state == "confirmed" || state == "rejected" {
		return errors.New("confirmation already resolved")
	}
	if n.ExpiresAt <= now() {
		return errors.New("confirmation expired")
	}
	b, err := readProjectBoard(ctx, tx, n.ProjectID)
	if err != nil {
		return err
	}
	if b.Rev != n.Revision || StageDigest(b, n.StageID) != n.Digest {
		return ErrBoardStale
	}
	if approve {
		if _, err = approveStageTx(ctx, tx, n.ProjectID, n.StageID, channel+":"+peer, n.Revision); err != nil {
			return err
		}
		state = "confirmed"
	} else {
		state = "rejected"
	}
	_, err = tx.ExecContext(ctx, `UPDATE pm_deliveries SET state=? WHERE project_id=? AND json_extract(content,'$.stageId')=? AND json_extract(content,'$.digest')=? AND state NOT IN ('confirmed','rejected')`, state, n.ProjectID, n.StageID, n.Digest)
	if err != nil {
		return err
	}
	return tx.Commit()
}
