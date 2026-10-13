package store

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"github.com/jiangmuran/vibepanel/internal/secret"
)

// Values sealed under the panel's secrets key, inside columns that are
// otherwise plain: a launch profile's secret variables and the webhook list.
//
// Every other credential the panel keeps -- chat tokens, page and plugin
// secrets, the hook token, share links' addresses -- is sealed, so a copy of
// the database alone hands over none of them; these two were the exception.
// The key sits beside the database in the data directory, which is why the
// store opens it itself rather than every caller (the panel, and the CLI
// reading a profile to launch from a shell) having to.
//
// sealedPrefix marks a sealed value. Anything without it is a value written
// before this existed, read as it is and sealed by ResealPlaintext.
const sealedPrefix = "vpsealed1:"

type sealer struct {
	once sync.Once
	path string
	box  *secret.Box
	err  error
}

func (d *DB) secrets() (*secret.Box, error) {
	d.seal.once.Do(func() {
		if d.seal.path == "" {
			d.seal.err = secret.ErrCorrupt
			return
		}
		d.seal.box, d.seal.err = secret.Open(d.seal.path)
	})
	return d.seal.box, d.seal.err
}

func keyPathFor(dbPath string) string {
	if dbPath == "" || strings.HasPrefix(dbPath, ":memory:") || strings.HasPrefix(dbPath, "file:") {
		return ""
	}
	return filepath.Join(filepath.Dir(dbPath), secret.KeyFile)
}

// sealString seals v under context. When the key cannot be opened it returns
// v as it is: the save goes through, as it did before sealing existed, and
// ResealPlaintext seals it on a later start that can.
func (d *DB) sealString(v, context string) string {
	if v == "" || strings.HasPrefix(v, sealedPrefix) {
		return v
	}
	box, err := d.secrets()
	if err != nil {
		return v
	}
	return sealedPrefix + base64.RawStdEncoding.EncodeToString(box.Seal([]byte(v), context))
}

// openString is sealString's inverse. A value without the prefix is a
// plaintext one from before, returned as it is. One that does not open --
// no key, the wrong key, moved to another row -- is "", ok false.
func (d *DB) openString(v, context string) (string, bool) {
	if !strings.HasPrefix(v, sealedPrefix) {
		return v, true
	}
	box, err := d.secrets()
	if err != nil {
		return "", false
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(v, sealedPrefix))
	if err != nil {
		return "", false
	}
	out, err := box.Unseal(raw, context)
	if err != nil {
		return "", false
	}
	return string(out), true
}

func settingContext(key string) string { return "setting:" + key }

// GetSealedSetting is GetSetting for a value kept sealed. A row written before
// sealing existed reads as it is.
func (d *DB) GetSealedSetting(ctx context.Context, key, def string) (string, error) {
	raw, err := d.GetSetting(ctx, key, def)
	if err != nil || raw == def {
		return raw, err
	}
	out, ok := d.openString(raw, settingContext(key))
	if !ok {
		return def, nil
	}
	return out, nil
}

// SetSealedSetting is SetSetting, sealed.
func (d *DB) SetSealedSetting(ctx context.Context, key, value string) error {
	return d.SetSetting(ctx, key, d.sealString(value, settingContext(key)))
}

// ResealPlaintext seals what was written before sealing existed, or while the
// key could not be opened: secret variables in launch profiles, and the
// settings named in keys. The panel calls it at start. A value already sealed
// is left alone, so running it twice writes nothing.
func (d *DB) ResealPlaintext(ctx context.Context, keys ...string) (int, error) {
	if _, err := d.secrets(); err != nil {
		return 0, err
	}
	n := 0
	rows, err := d.listLaunchRows(ctx)
	if err != nil {
		return 0, err
	}
	for _, p := range rows {
		var stored string
		if err := d.sql.QueryRowContext(ctx, `SELECT env FROM launch_profiles WHERE id = ?`, p.ID).Scan(&stored); err != nil {
			return n, fmt.Errorf("store: reseal launch profile: %w", err)
		}
		_, env, err := d.encodeLaunch(p.ID, p)
		if err != nil {
			return n, err
		}
		if env == stored || !strings.Contains(stored, `"secret":true`) {
			continue
		}
		var before []LaunchEnvVar
		_ = json.Unmarshal([]byte(stored), &before)
		plain := false
		for _, v := range before {
			if v.Secret && v.Value != "" && !strings.HasPrefix(v.Value, sealedPrefix) {
				plain = true
			}
		}
		if !plain {
			continue
		}
		if _, err := d.sql.ExecContext(ctx, `UPDATE launch_profiles SET env = ? WHERE id = ?`, env, p.ID); err != nil {
			return n, fmt.Errorf("store: reseal launch profile: %w", err)
		}
		n++
	}
	for _, key := range keys {
		raw, err := d.GetSetting(ctx, key, "")
		if err != nil {
			return n, err
		}
		if raw == "" || strings.HasPrefix(raw, sealedPrefix) {
			continue
		}
		if err := d.SetSealedSetting(ctx, key, raw); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}
