package dev.simon.mocklocation;

import android.app.Activity;
import android.content.Intent;
import android.location.Location;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

/**
 * Headless helper driven by simon over adb. Started as an Activity (adb am start
 * counts as a foreground launch, so it dodges the background-FGS restriction),
 * it registers test location providers and republishes the given coordinates
 * once a second, then hides itself. Killing the app (adb am force-stop) removes
 * the test providers, which is how simon clears a mocked location.
 */
public class MockLocationActivity extends Activity {

    private static final String[] PROVIDERS = {
            LocationManager.GPS_PROVIDER,
            LocationManager.NETWORK_PROVIDER,
    };

    private final Handler handler = new Handler(Looper.getMainLooper());
    private LocationManager lm;
    private double lat;
    private double lon;

    private final Runnable pusher = new Runnable() {
        @Override
        public void run() {
            pushLocation();
            handler.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (getIntent().getBooleanExtra("stop", false) || !applyExtras(getIntent())) {
            clearProviders();
            finish();
            return;
        }
        setupProviders();
        handler.post(pusher);
        moveTaskToBack(true);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent.getBooleanExtra("stop", false)) {
            clearProviders();
            finish();
            return;
        }
        applyExtras(intent);
    }

    private void clearProviders() {
        handler.removeCallbacks(pusher);
        if (lm == null) return;
        for (String p : PROVIDERS) {
            try {
                lm.setTestProviderEnabled(p, false);
            } catch (Exception ignored) {
            }
            try {
                lm.removeTestProvider(p);
            } catch (Exception ignored) {
            }
        }
    }

    private boolean applyExtras(Intent intent) {
        try {
            lat = Double.parseDouble(intent.getStringExtra("lat"));
            lon = Double.parseDouble(intent.getStringExtra("lon"));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void setupProviders() {
        for (String p : PROVIDERS) {
            try {
                lm.addTestProvider(p, false, false, false, false, true, true, true, 1, 1);
            } catch (Exception ignored) {
            }
            try {
                lm.setTestProviderEnabled(p, true);
            } catch (Exception ignored) {
            }
        }
    }

    private void pushLocation() {
        for (String p : PROVIDERS) {
            try {
                Location loc = new Location(p);
                loc.setLatitude(lat);
                loc.setLongitude(lon);
                loc.setAccuracy(1f);
                loc.setTime(System.currentTimeMillis());
                loc.setElapsedRealtimeNanos(SystemClock.elapsedRealtimeNanos());
                lm.setTestProviderLocation(p, loc);
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        clearProviders();
    }
}
