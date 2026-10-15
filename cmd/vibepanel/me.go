package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// `vibepanel me`: the session's own voice (docs/cli.md, "From inside a
// session"). Run by the agent inside a session, with nothing to configure:
// the environment the panel gave the session holds its id, its own token
// and the panel's address. The token names that one session and reaches
// /api/me/v1 and nothing else, so an agent can say what it is up to and
// cannot touch another session, a project or the owner's settings. The
// owner does the same to any session with `vibepanel session info`.

const meUsage = `usage: vibepanel me [--json]
       vibepanel me state <working|waiting|done> [--why "what for"]
       vibepanel me title <title>
       vibepanel me info set <summary|progress|labels> <value>
       vibepanel me info clear [summary|progress|labels]
       vibepanel me say <text>
       vibepanel me notify <text> [--level info|warn|ask] [--choices a,b]
       vibepanel me send <file> [--caption "..."]
       vibepanel me guide [--write [dir]]

Run inside a session the panel started. The agent says what it is up to:
state (mark waiting before asking a person), a title, a one-line summary,
progress 0-100, up to five labels (comma-separated). "guide" prints when
to use which; "guide --write" puts it in a project's AGENTS.md, once.`

type meClient struct {
	base, session, token string
	http                 *http.Client
}

func openMe() (*meClient, error) {
	sid, token, base := os.Getenv("VIBEPANEL_SESSION_ID"), os.Getenv("VIBEPANEL_TOKEN"), strings.TrimRight(os.Getenv("VIBEPANEL_URL"), "/")
	if sid == "" || token == "" || base == "" {
		return nil, errors.New("vibepanel me runs inside a session the panel started: VIBEPANEL_SESSION_ID, VIBEPANEL_TOKEN and VIBEPANEL_URL are not set here")
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("VIBEPANEL_URL %q is not an http(s) URL", base)
	}
	return &meClient{base: base, session: sid, token: token,
		http: &http.Client{Timeout: 20 * time.Second, Transport: mcpTransport(u.Hostname())}}, nil
}

func (c *meClient) headers() map[string]string {
	return map[string]string{"Authorization": "Bearer " + c.token, "X-Vibepanel-Session": c.session}
}

func (c *meClient) do(ctx context.Context, method, path string, body any, out any) error {
	var payload []byte
	if body != nil {
		var err error
		if payload, err = json.Marshal(body); err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("X-Vibepanel-Session", c.session)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("the panel at %s did not answer: %s", c.base, trimDial(err))
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		return &apiError{Status: res.StatusCode, Message: e.Error}
	}
	if out != nil && len(raw) > 0 {
		return json.Unmarshal(raw, out)
	}
	return nil
}

// meView is what the door answers; restated here as the CLI reads it.
type meView struct {
	ID       string   `json:"id"`
	Project  string   `json:"project"`
	Title    string   `json:"title"`
	State    string   `json:"state"`
	Summary  string   `json:"summary"`
	Progress int      `json:"progress"`
	Labels   []string `json:"labels"`
	Pinned   bool     `json:"pinned"`
}

func cmdMe(args []string) error {
	if len(args) > 0 && (args[0] == "-h" || args[0] == "--help" || args[0] == "help") {
		fmt.Println(meUsage)
		return nil
	}
	if len(args) > 0 && args[0] == "guide" {
		return meGuideCmd(args[1:])
	}
	ctx := context.Background()
	c, err := openMe()
	if err != nil {
		return err
	}
	if len(args) == 0 || args[0] == "--json" {
		var v meView
		if err := c.do(ctx, http.MethodGet, "/api/me/v1", nil, &v); err != nil {
			return err
		}
		if len(args) == 1 {
			return printJSON(v)
		}
		printMe(v)
		return nil
	}
	switch args[0] {
	case "say", "notify":
		return meSpeak(ctx, c, args[0], args[1:])
	case "send":
		fs := flag.NewFlagSet("me send", flag.ContinueOnError)
		caption := fs.String("caption", "", "a line with the file")
		pos, err := parseInterspersed(fs, args[1:])
		if err != nil {
			return err
		}
		if len(pos) != 1 {
			return errors.New("usage: vibepanel me send <file> [--caption \"...\"]")
		}
		var out attachResult
		if err := uploadFile(ctx, c.http, c.base+"/api/me/v1/send", c.headers(), pos[0], *caption, &out); err != nil {
			return err
		}
		fmt.Printf("sent %s (%s): every open page, %d contact(s); the owner downloads it at %s\n", out.Name, out.Size, out.Contacts, out.URL)
		return nil
	}
	patch := map[string]any{}
	switch args[0] {
	case "state":
		fs := flag.NewFlagSet("me state", flag.ContinueOnError)
		why := fs.String("why", "", "what the state is about, e.g. what you are waiting for")
		pos, err := parseInterspersed(fs, args[1:])
		if err != nil {
			return err
		}
		if len(pos) != 1 {
			return errors.New("usage: vibepanel me state <working|waiting|done> [--why \"what for\"]")
		}
		patch["state"] = pos[0]
		if *why != "" {
			patch["why"] = *why
		}
	case "title":
		if len(args) < 2 {
			return errors.New("usage: vibepanel me title <title>")
		}
		patch["title"] = strings.Join(args[1:], " ")
	case "info":
		if len(args) < 2 {
			return errors.New(meUsage)
		}
		switch args[1] {
		case "set":
			if len(args) < 4 {
				return errors.New("usage: vibepanel me info set <summary|progress|labels> <value>")
			}
			value := strings.Join(args[3:], " ")
			switch args[2] {
			case "summary":
				patch["summary"] = value
			case "progress":
				n, err := strconv.Atoi(strings.TrimSuffix(value, "%"))
				if err != nil || n < 0 || n > 100 {
					return errors.New("progress is a number from 0 to 100")
				}
				patch["progress"] = n
			case "labels":
				labels := []string{}
				for _, l := range strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == ' ' }) {
					labels = append(labels, l)
				}
				patch["labels"] = labels
			default:
				return errors.New("info set takes summary, progress or labels")
			}
		case "clear":
			which := []string{"summary", "progress", "labels"}
			if len(args) >= 3 {
				which = args[2:]
			}
			for _, w := range which {
				switch w {
				case "summary":
					patch["summary"] = ""
				case "progress":
					patch["progress"] = -1
				case "labels":
					patch["labels"] = []string{}
				default:
					return errors.New("info clear takes summary, progress or labels")
				}
			}
		default:
			return errors.New(meUsage)
		}
	default:
		return fmt.Errorf("unknown me command %q\n\n%s", args[0], meUsage)
	}
	var v meView
	if err := c.do(ctx, http.MethodPatch, "/api/me/v1", patch, &v); err != nil {
		return err
	}
	printMe(v)
	return nil
}

func printMe(v meView) {
	mark := map[string]string{"working": "●", "waiting": "▲", "done": "✓"}[v.State]
	if mark == "" {
		mark = "○"
	}
	fmt.Printf("%s %s  %s  (%s, in %s)\n", mark, v.State, v.Title, v.ID, v.Project)
	if v.Summary != "" {
		fmt.Printf("  %s\n", v.Summary)
	}
	if v.Progress >= 0 {
		fmt.Printf("  progress %d%%\n", v.Progress)
	}
	if len(v.Labels) > 0 {
		fmt.Printf("  labels %s\n", strings.Join(v.Labels, ", "))
	}
}

// meGuide is the best practice, printed by `vibepanel me guide` and written
// into a project's AGENTS.md by `vibepanel hook install --guide`. Short on
// purpose: an agent reads it once per session.
const meGuide = `# Talking to vibepanel from inside a session

You are running in a session the panel supervises. ` + "`vibepanel me`" + ` is
your voice to the person watching the panel on a laptop or a phone. It
needs nothing: the environment already holds your session's credential.

- ` + "`vibepanel me state waiting --why \"what you need decided\"`" + ` **before**
  asking a person anything. The panel shows a ▲ beside your session, and
  the phone gets a card with the why. Go back to working with
  ` + "`vibepanel me state working`" + ` when you have the answer; ` + "`done`" + ` when
  the task is finished and you are stopping.
- ` + "`vibepanel me info set summary \"...\"`" + ` once per milestone: one line a
  person reads at 2am under your session's title. What is done, what is
  next, what is blocked. No paths, no secrets, no stack traces.
- ` + "`vibepanel me info set progress 60`" + ` when you can honestly say so;
  ` + "`labels db,migration`" + ` for what the work is about (up to five).
- ` + "`vibepanel me title \"...\"`" + ` if the title the panel guessed from your
  terminal is wrong.
- ` + "`vibepanel me say \"...\"`" + ` for a milestone worth a line on the phone
  and a quiet toast on the panel: the migration ran, the tests pass.
- ` + "`vibepanel me notify \"...\" --choices drop,keep`" + ` only when a person
  has to decide now: it rings every open page and every phone, with the
  choices as buttons, and the pressed one is typed into this session. Mark
  ` + "`waiting`" + ` first, then read the answer from stdin as you would any
  reply. Six a minute at most; past that, say it in the summary.
- ` + "`vibepanel me send ./chart.png --caption \"...\"`" + ` for a result that is
  a picture or a file: an image reaches the phone as a photo, anything
  else as a link the owner opens signed in. 16 MB a file.
- Do not loop on these. A state change is an event on somebody's phone;
  say a thing once.
`

// meSpeak is say and notify: the text from the arguments or stdin, and for
// notify the level and the choices. The answer to an ask arrives in the
// terminal, typed, which is where the agent reads everything.
func meSpeak(ctx context.Context, c *meClient, what string, args []string) error {
	fs := flag.NewFlagSet("me "+what, flag.ContinueOnError)
	level := fs.String("level", "info", "info, warn or ask (notify only)")
	choices := fs.String("choices", "", "comma-separated buttons for the phone; a press types the choice into this session")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return err
	}
	text := strings.Join(pos, " ")
	if len(pos) == 0 {
		raw, rerr := io.ReadAll(io.LimitReader(os.Stdin, 64<<10))
		if rerr != nil {
			return rerr
		}
		text = string(raw)
	}
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("usage: vibepanel me %s <text>   (or text on stdin)", what)
	}
	if what == "say" {
		if err := c.do(ctx, http.MethodPost, "/api/me/v1/say", map[string]any{"text": text}, nil); err != nil {
			return err
		}
		fmt.Println("said")
		return nil
	}
	list := []string{}
	for _, ch := range strings.Split(*choices, ",") {
		if ch = strings.TrimSpace(ch); ch != "" {
			list = append(list, ch)
		}
	}
	var out struct {
		Contacts int `json:"contacts"`
	}
	if err := c.do(ctx, http.MethodPost, "/api/me/v1/notify", map[string]any{"text": text, "level": *level, "choices": list}, &out); err != nil {
		return err
	}
	fmt.Printf("notified: every open page, and %d contact(s) on the phone\n", out.Contacts)
	if len(list) > 0 {
		fmt.Println("the answer arrives here as typed input; read it from where you read everything")
	}
	return nil
}

// guideMarker is the heading the written guide starts with, and what a
// second --write looks for before writing again.
const guideMarker = "# Talking to vibepanel from inside a session"

// meGuideCmd prints the guide, or writes it into a project's AGENTS.md
// (the current directory's by default) under its own heading, once:
// a file that already carries the heading is left alone, and a missing
// CLAUDE.md gets the one line that points at AGENTS.md.
func meGuideCmd(args []string) error {
	fs := flag.NewFlagSet("me guide", flag.ContinueOnError)
	write := fs.Bool("write", false, "append the guide to AGENTS.md in the directory (default: the current one)")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return err
	}
	if !*write {
		fmt.Print(meGuide)
		return nil
	}
	dir := "."
	if len(pos) == 1 {
		dir = pos[0]
	} else if len(pos) > 1 {
		return errors.New("usage: vibepanel me guide --write [dir]")
	}
	dir, err = filepath.Abs(dir)
	if err != nil {
		return err
	}
	agents := filepath.Join(dir, "AGENTS.md")
	existing, rerr := os.ReadFile(agents) //nolint:gosec // the person named the directory
	if rerr == nil && strings.Contains(string(existing), guideMarker) {
		fmt.Printf("%s already has the guide\n", agents)
		return nil
	}
	f, err := os.OpenFile(agents, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o644) //nolint:gosec // a project file
	if err != nil {
		return err
	}
	sep := ""
	if len(existing) > 0 && !strings.HasSuffix(string(existing), "\n\n") {
		sep = "\n"
		if !strings.HasSuffix(string(existing), "\n") {
			sep = "\n\n"
		}
	}
	if _, err := f.WriteString(sep + meGuide); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	fmt.Printf("wrote the guide into %s\n", agents)
	claude := filepath.Join(dir, "CLAUDE.md")
	if _, err := os.Stat(claude); errors.Is(err, os.ErrNotExist) {
		if err := os.WriteFile(claude, []byte("@AGENTS.md\n"), 0o644); err == nil { //nolint:gosec // a project file
			fmt.Printf("wrote %s pointing at it\n", claude)
		}
	}
	return nil
}
