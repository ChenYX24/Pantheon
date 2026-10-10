package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHomeWebhookSigningAndSend(t *testing.T) {
	const signature = "eSSBpPPdWfBl7avPl9BWSBfQOnLGZ91Xn8G5oZis0sc="
	if got := homeWebhookSign("1700000000", "fixture-secret"); got != signature {
		t.Fatal("signature", got)
	}
	calls := 0
	code := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "POST" || r.Header.Get("Content-Type") != "application/json" {
			t.Error("invalid request")
		}
		var body struct {
			Type    string `json:"msg_type"`
			Content struct {
				Text string `json:"text"`
			} `json:"content"`
			Timestamp string `json:"timestamp"`
			Sign      string `json:"sign"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Type != "text" || body.Content.Text != "[Pantheon] 测试通知" || body.Timestamp != "1700000000" || body.Sign != signature {
			t.Errorf("payload: %+v", body)
		}
		fmt.Fprintf(w, `{"code":%d}`, code)
	}))
	defer server.Close()
	at := time.Unix(1700000000, 0)
	if err := SendHomeWebhook(context.Background(), server.Client(), server.URL, "fixture-secret", "[Pantheon] 测试通知", at); err != nil {
		t.Fatal(err)
	}
	code = 19001
	if err := SendHomeWebhook(context.Background(), server.Client(), server.URL, "fixture-secret", "[Pantheon] 测试通知", at); err == nil || !strings.Contains(err.Error(), "19001") {
		t.Fatal("code accepted", err)
	}
	if calls != 2 {
		t.Fatal(calls)
	}
}

func TestHomeWebhookUnsignedAndSafeFailures(t *testing.T) {
	status := 200
	response := `{"code":0}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if _, ok := body["sign"]; ok {
			t.Error("unexpected signature")
		}
		if _, ok := body["timestamp"]; ok {
			t.Error("unexpected timestamp")
		}
		w.Header().Set("Location", "http://must-not-follow.invalid")
		w.WriteHeader(status)
		fmt.Fprint(w, response)
	}))
	defer server.Close()
	if err := SendHomeWebhook(context.Background(), server.Client(), server.URL, "", "hello", time.Now()); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		status   int
		response string
	}{{200, "bad JSON"}, {200, `{}`}, {302, ""}, {500, "private remote error"}} {
		status, response = test.status, test.response
		err := SendHomeWebhook(context.Background(), server.Client(), server.URL, "", "hello", time.Now())
		if err == nil || strings.Contains(err.Error(), server.URL) || strings.Contains(err.Error(), "private remote error") {
			t.Fatal("unsafe or missing error", err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := SendHomeWebhook(ctx, server.Client(), server.URL+"/secret-token", "", "hello", time.Now()); err == nil || strings.Contains(err.Error(), "secret-token") {
		t.Fatal("URL leaked", err)
	}
}
