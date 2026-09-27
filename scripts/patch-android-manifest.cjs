// One-off: add Health Connect permissions + rationale intent-filters to the
// generated Android manifest. Safe to re-run (idempotent).
const fs = require("fs");
const path = require("path");

const p = path.resolve(__dirname, "..", "android", "app", "src", "main", "AndroidManifest.xml");
let s = fs.readFileSync(p, "utf8");

if (s.includes("android.permission.health.READ_EXERCISE")) {
  console.log("already patched");
  process.exit(0);
}

const perms = `    <!-- Health Connect: read-only access to exactly the data Vaylo uses.
         Required by Android 14+ to be declared in the manifest. -->
    <uses-permission android:name="android.permission.health.READ_EXERCISE" />
    <uses-permission android:name="android.permission.health.READ_DISTANCE" />
    <uses-permission android:name="android.permission.health.READ_TOTAL_CALORIES_BURNED" />
    <uses-permission android:name="android.permission.health.READ_HEART_RATE" />
    <uses-permission android:name="android.permission.health.READ_STEPS" />
    <uses-permission android:name="android.permission.health.READ_SLEEP" />

    <application`;

s = s.replace("    <application", perms);

const oldAct = `            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

        </activity>`;

const newAct = `            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

            <!-- Health Connect permission rationale (required for Play). -->
            <intent-filter>
                <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />
            </intent-filter>

        </activity>

        <!-- Android 14+ permission-usage entry point (opens the privacy policy). -->
        <activity-alias
            android:name="ViewPermissionUsageActivity"
            android:exported="true"
            android:targetActivity=".MainActivity"
            android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
            <intent-filter>
                <action android:name="android.intent.action.VIEW_PERMISSION_USAGE" />
                <category android:name="android.intent.category.HEALTH_PERMISSIONS" />
            </intent-filter>
        </activity-alias>`;

if (!s.includes(oldAct)) {
  console.error("activity block not found — manifest layout changed?");
  process.exit(1);
}
s = s.replace(oldAct, newAct);

fs.writeFileSync(p, s, "utf8");
console.log("manifest updated:", (s.match(/android.permission.health/g) || []).length, "health permissions");
