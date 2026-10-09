package store

import (
	"context"
	"errors"
	"sync"
	"testing"
)

func TestProjectBoardConcurrentSaveAndCompletion(t *testing.T) {
	db := openTest(t)
	ctx := context.Background()
	if _, err := db.CreateProject(ctx, "board", "Board", t.TempDir()); err != nil {
		t.Fatal(err)
	}
	b, err := db.GetProjectBoard(ctx, "board")
	if err != nil || b.Rev != 0 || b.Tasks == nil {
		t.Fatalf("empty board: %+v %v", b, err)
	}
	b.Tasks = []BoardTask{{ID: "task", Title: "Deploy", Status: "done"}}
	if _, err := db.SaveProjectBoard(ctx, b); err == nil {
		t.Fatal("accepted completion without evidence")
	}
	b.Tasks[0].Status = "ready"
	for round := 0; round < 2; round++ {
		var wg sync.WaitGroup
		errs := make([]error, 4)
		for i := range errs {
			wg.Add(1)
			go func(i int) { defer wg.Done(); _, errs[i] = db.SaveProjectBoard(ctx, b) }(i)
		}
		wg.Wait()
		wins := 0
		for _, err := range errs {
			if err == nil {
				wins++
			} else if !errors.Is(err, ErrBoardStale) {
				t.Fatal(err)
			}
		}
		if wins != 1 {
			t.Fatalf("concurrent saves: %d winners", wins)
		}
		b, err = db.GetProjectBoard(ctx, "board")
		if err != nil {
			t.Fatal(err)
		}
	}
	if b.Rev != 2 || len(b.Tasks) != 1 {
		t.Fatalf("lost data: %+v", b)
	}
}
