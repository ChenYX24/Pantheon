package store

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestHomeThreadsAndAtomicPending(t *testing.T) {
	db := openTest(t)
	ctx := context.Background()
	threads, err := db.HomeThreads(ctx, "p")
	if err != nil || len(threads) != 1 || threads[0].ID != "main" {
		t.Fatal(threads, err)
	}
	thread, err := db.CreateHomeThread(ctx, "p", "")
	if err != nil || !strings.HasPrefix(thread.Title, "新对话 ") {
		t.Fatal(thread, err)
	}
	user, pending, err := db.BeginHomeDiscussion(ctx, "p", thread.ID, strings.Repeat("中", 40), ModelAssignment{Harness: "codex", Model: "test"})
	if err != nil || pending.Status != "pending" || user.Status != "done" {
		t.Fatal(user, pending, err)
	}
	if _, _, err = db.BeginHomeDiscussion(ctx, "p", "main", "overlap", ModelAssignment{}); !errors.Is(err, ErrHomePending) {
		t.Fatal("overlap", err)
	}
	messages, err := db.HomeMessages(ctx, "p", "main")
	if err != nil || len(messages) != 0 {
		t.Fatal("partial conflicting turn", messages, err)
	}
	threads, err = db.HomeThreads(ctx, "p")
	if err != nil || threads[0].Title != strings.Repeat("中", 30) || threads[0].MessageCount != 2 {
		t.Fatal("rename/count", threads, err)
	}
	reason := "offline"
	pending.Status = "failed"
	pending.Error = &reason
	if err = db.CompleteHomeDiscussion(ctx, "p", pending); err != nil {
		t.Fatal(err)
	}
	retriedUser, retried, err := db.RetryHomeDiscussion(ctx, "p", pending.ID)
	if err != nil || retried.ID != pending.ID || retried.Status != "pending" || retried.Error != nil || retriedUser.ID != user.ID {
		t.Fatal(retried, err)
	}
	retried.Status = "done"
	retried.Text = "Recovered"
	if err = db.CompleteHomeDiscussion(ctx, "p", retried); err != nil {
		t.Fatal(err)
	}
	if err = db.RenameHomeThread(ctx, "p", thread.ID, "Kept title"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.AddHomeMessage(ctx, "p", HomeMessage{ThreadID: thread.ID, Role: "user", Text: "later"}); err != nil {
		t.Fatal(err)
	}
	if err = db.DeleteHomeThread(ctx, "p", "main"); !errors.Is(err, ErrHomeMain) {
		t.Fatal(err)
	}
	if err = db.DeleteHomeThread(ctx, "p", thread.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.HomeMessages(ctx, "p", thread.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("deleted thread", err)
	}
	var count int
	if err = db.sql.QueryRow(`SELECT COUNT(*) FROM home_messages WHERE project_id='p'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("orphan messages", count, err)
	}
	// Concurrent requests must produce exactly one complete pair, never an orphan user.
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for n := 0; n < 2; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, err := db.BeginHomeDiscussion(ctx, "parallel", "main", "hello", ModelAssignment{})
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	success, conflicts := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, ErrHomePending) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatal(success, conflicts)
	}
	messages, err = db.HomeMessages(ctx, "parallel")
	if err != nil || len(messages) != 2 {
		t.Fatal(messages, err)
	}
}

func TestHomeRestartFailsOnlyStalePending(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "restart.db")
	db, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	_, old, err := db.BeginHomeDiscussion(ctx, "old", "main", "old", ModelAssignment{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.sql.Exec(`UPDATE home_messages SET created_at=? WHERE id=?`, time.Now().Add(-11*time.Minute).UnixNano(), old.ID); err != nil {
		t.Fatal(err)
	}
	_, _, err = db.BeginHomeDiscussion(ctx, "recent", "main", "recent", ModelAssignment{})
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	db, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rows, err := db.HomeMessages(ctx, "old")
	if err != nil {
		t.Fatal(err)
	}
	var failed HomeMessage
	for _, m := range rows {
		if m.ID == old.ID {
			failed = m
		}
	}
	if failed.Status != "failed" || failed.Error == nil || *failed.Error != "interrupted by restart" {
		t.Fatal(failed)
	}
	rows, err = db.HomeMessages(ctx, "recent")
	if err != nil || rows[1].Status != "pending" {
		t.Fatal(rows, err)
	}
}
