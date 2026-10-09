package store

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func TestHomeMessagesSurviveWithoutPanelProjects(t *testing.T) {
	db := openTest(t)
	ctx := context.Background()
	for n := 0; n < 105; n++ {
		_, err := db.AddHomeMessage(ctx, "harness-only", HomeMessage{Role: "assistant", Text: fmt.Sprint(n), Executor: &ModelAssignment{Harness: "codex", Model: "test"}, Suggestions: json.RawMessage(`[{"type":"create_session","name":"Review"}]`)})
		if err != nil {
			t.Fatal(err)
		}
	}
	messages, err := db.HomeMessages(ctx, "harness-only")
	if err != nil || len(messages) != 100 || messages[0].Text != "5" || messages[99].Text != "104" || messages[0].Executor.Model != "test" || len(messages[0].Suggestions) == 0 {
		t.Fatalf("messages: %d %v", len(messages), err)
	}
	if _, err = db.AddHomeMessage(ctx, "harness-only", HomeMessage{Role: "system"}); err == nil {
		t.Fatal("invalid role")
	}
}

func TestHomeDeliveryBaselineAndDedup(t *testing.T) {
	db := openTest(t)
	ctx := context.Background()
	if empty, err := db.HomeDeliveriesEmpty(ctx); err != nil || !empty {
		t.Fatal("fresh database")
	}
	rows := []HomeDelivery{{TodoID: "todo", ProjectID: "p", Channel: "feishu", Peer: "a", Status: "baseline", Text: "hello", CreatedAt: time.Now().Format(time.RFC3339)}, {TodoID: "todo", ProjectID: "p", Channel: "feishu", Peer: "b", Status: "baseline", Text: "hello", CreatedAt: time.Now().Format(time.RFC3339)}}
	for n := 0; n < 2; n++ {
		if err := db.RecordHomeDeliveries(ctx, rows); err != nil {
			t.Fatal(err)
		}
	}
	rows[0].Peer = "later"
	if err := db.RecordHomeDeliveries(ctx, rows[:1]); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.sql.QueryRow(`SELECT COUNT(*) FROM home_deliveries`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("dedup: %d %v", count, err)
	}
	if shown, err := db.HomeDeliveries(ctx); err != nil || len(shown) != 0 {
		t.Fatal("baseline leaked into delivery history")
	}
	if empty, err := db.HomeDeliveriesEmpty(ctx); err != nil || empty {
		t.Fatal("lost baseline")
	}
	rows[0].TodoID = "next"
	rows[0].Status = "pending"
	if err := db.RecordHomeDeliveries(ctx, rows[:1]); err != nil {
		t.Fatal(err)
	}
	pending, err := db.PendingHomeDeliveries(ctx, time.Now().Unix())
	if err != nil || len(pending) != 1 {
		t.Fatal("pending", err)
	}
	n := pending[0]
	n.Attempts = 1
	n.NextAttemptAt = time.Now().Add(time.Minute).Unix()
	if err = db.UpdateHomeDelivery(ctx, n); err != nil {
		t.Fatal(err)
	}
	if pending, err = db.PendingHomeDeliveries(ctx, time.Now().Unix()); err != nil || len(pending) != 0 {
		t.Fatal("backoff ignored")
	}
}
