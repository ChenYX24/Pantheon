package httpapi

import (
	"strings"
	"testing"
)

// The Permissions-Policy on share pages, plugin frames and admin pages names
// only features Chromium recognises. An unknown one is ignored, and logged as
// a warning on every load -- `bluetooth` was, on every page that carried this
// header. Taken from Chromium's permissions_policy_features.json5; a feature
// added to the header has to be added here, which is the moment to check that
// a browser knows it.
func TestThePermissionsPolicyNamesOnlyKnownFeatures(t *testing.T) {
	known := map[string]bool{
		"accelerometer": true, "ambient-light-sensor": true, "autoplay": true,
		"camera": true, "display-capture": true, "encrypted-media": true,
		"fullscreen": true, "gamepad": true, "geolocation": true, "gyroscope": true,
		"hid": true, "idle-detection": true, "magnetometer": true, "microphone": true,
		"midi": true, "payment": true, "picture-in-picture": true,
		"publickey-credentials-get": true, "screen-wake-lock": true, "serial": true,
		"usb": true, "web-share": true, "xr-spatial-tracking": true,
	}
	for _, part := range strings.Split(sharePagePermissions, ",") {
		name, _, _ := strings.Cut(strings.TrimSpace(part), "=")
		if !known[name] {
			t.Errorf("Permissions-Policy names %q, which Chromium does not recognise and logs on every load", name)
		}
	}
}
