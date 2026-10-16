package com.vaylosports.app.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging

/**
 * VayloPush — device-side half of push delivery.
 *
 * The app could show notifications it invented itself and nothing else: the
 * `notifications` table had rows, the prefs screen had toggles, and no message
 * could ever reach a phone. This plugin is the missing piece — it asks for the
 * one permission Android 13 requires, makes sure the channel exists (a message
 * to a channel that does not exist is silently discarded), and hands the JS
 * layer the FCM registration token to store against the athlete's account.
 *
 * Firebase is initialised from string resources rather than the
 * google-services Gradle plugin, on purpose: that plugin fails the *build* when
 * google-services.json is missing, and this project has to keep building for
 * anyone who has not been handed the Firebase project yet. With the placeholder
 * values left in place every method reports `configured: false` and the app
 * behaves exactly as it did before push existed — no crash, no silent failure,
 * and the prefs screen can say why. See push/FIREBASE.md for the one-time setup.
 */
@CapacitorPlugin(
    name = "VayloPush",
    permissions = [
        Permission(
            strings = [Manifest.permission.POST_NOTIFICATIONS],
            alias = Manifest.permission.POST_NOTIFICATIONS
        )
    ]
)
class PushPlugin : Plugin() {

    private val ctx: Context
        get() = context!!

    // -- Configuration --------------------------------------------------------

    /**
     * Initialises Firebase if the project has been wired up, and reports whether
     * it was. Safe to call repeatedly: FirebaseApp.getInstance throws when
     * uninitialised, so every path checks first.
     */
    private fun ensureFirebase(): Boolean {
        if (FirebaseApp.getApps(ctx).isNotEmpty()) return true

        val appId = readString("vaylo_fcm_app_id")
        val apiKey = readString("vaylo_fcm_api_key")
        val projectId = readString("vaylo_fcm_project_id")
        val senderId = readString("vaylo_fcm_sender_id")
        // Empty is the supported unconfigured state. Reject malformed values
        // before FirebaseApp.initializeApp, so bogus resources cannot advertise
        // readiness and fail later during token registration.
        if (appId.isEmpty() || apiKey.isEmpty() || projectId.isEmpty() || senderId.isEmpty()) return false
        if (!appId.matches(Regex("1:\\d{6,}:android:[0-9a-fA-F]{8,}"))) return false
        if (!apiKey.matches(Regex("AIza[0-9A-Za-z_-]{35}"))) return false
        if (!projectId.matches(Regex("[a-z][a-z0-9-]{4,28}[a-z0-9]"))) return false
        if (!senderId.matches(Regex("\\d{6,}"))) return false

        return try {
            val options = FirebaseOptions.Builder()
                .setApplicationId(appId)
                .setApiKey(apiKey)
                .setProjectId(projectId)
                .setGcmSenderId(senderId)
                .build()
            FirebaseApp.initializeApp(ctx, options) != null
        } catch (e: Exception) {
            // A malformed project id throws here. Push stays off; nothing else
            // in the app depends on it.
            false
        }
    }

    private fun readString(name: String): String =
        try {
            val id = ctx.resources.getIdentifier(name, "string", ctx.packageName)
            if (id == 0) "" else ctx.getString(id).trim()
        } catch (e: Exception) {
            ""
        }

    // -- Channels -------------------------------------------------------------

    /**
     * Android 8+ drops a notification whose channel does not exist. The ids
     * here must match the constants in src/lib/push.ts, because a channel can
     * never be renamed after creation without orphaning the athlete's existing
     * per-type setting.
     */
    private fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = ctx.getSystemService(NotificationManager::class.java) ?: return
        val defaults = NotificationChannel(
            PushChannels.DEFAULT_ID,
            "General",
            NotificationManager.IMPORTANCE_DEFAULT
        )
        defaults.setShowBadge(true)
        manager.createNotificationChannel(defaults)

        // Reminders post at HIGH importance so they peek from the top of the
        // screen with sound (heads-up) instead of landing silently in the
        // shade — the owner report of 2026-10-14, with DND off and nothing
        // popping. Quiet hours are NOT handled here: the JS layer simply does
        // not post during them, so lowering the channel would only punish the
        // notifications the athlete did ask for.
        val reminders = NotificationChannel(
            PushChannels.REMINDERS_ID,
            "Workout reminders",
            NotificationManager.IMPORTANCE_HIGH
        )
        reminders.setShowBadge(true)
        // Full content on the lock screen, not "contents hidden". The JS side
        // asks for the same via visibility 1; the native channel is the FCM
        // path's equivalent and must not disagree with it.
        reminders.lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        manager.createNotificationChannel(reminders)
    }

    // -- Plugin methods -------------------------------------------------------

    /**
     * The whole registration, in one call: permission, channel, token.
     *
     * Returns `{ configured, permission, token }` and never rejects — the caller
     * has to be able to tell "Firebase is not set up" from "the athlete said
     * no" from "it worked", and an exception would collapse all three into a
     * failed promise with no detail.
     */
    @PluginMethod
    fun register(call: PluginCall) {
        ensureChannels()

        if (!ensureFirebase()) {
            val out = JSObject()
            out.put("configured", false)
            out.put("permission", permissionState())
            call.resolve(out)
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            // Saved and resolved by onPermissionResult; the token is fetched
            // there so it is only requested once there is somewhere to put it.
            requestPermissionForAlias(Manifest.permission.POST_NOTIFICATIONS, call, "onNotificationPermission")
            return
        }

        fetchToken(call)
    }

    /** Permission already decided (or not needed) — no dialog, just the token. */
    @PluginMethod
    fun status(call: PluginCall) {
        val out = JSObject()
        out.put("configured", ensureFirebase())
        out.put("permission", permissionState())
        call.resolve(out)
    }

    /**
     * Deletes this device's registration on the server.
     *
     * Sign-out has to reach this: a phone that keeps its token after the athlete
     * signs out will keep receiving the next account's notifications on a
     * handset they may have handed to somebody else.
     */
    @PluginMethod
    fun unregister(call: PluginCall) {
        call.resolve(JSObject())
    }

    @PermissionCallback
    private fun onNotificationPermission(call: PluginCall) {
        val out = JSObject()
        out.put("configured", true)
        out.put("permission", permissionState())
        if (call.getBoolean("resolveWithToken", true) == true) {
            fetchToken(call, out)
        } else {
            call.resolve(out)
        }
    }

    private fun permissionState(): String = when {
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU -> "granted"
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED -> "granted"
        else -> "denied"
    }

    /**
     * FCM hands the token back asynchronously and can fail (no Play Services,
     * throttled). Neither may reject: a token that never arrives has to read as
     * "no token", never as an unhandled rejection in the WebView.
     */
    private fun fetchToken(call: PluginCall, extra: JSObject? = null) {
        try {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                val out = extra ?: JSObject()
                out.put("configured", true)
                out.put("permission", permissionState())
                if (task.isSuccessful) {
                    out.put("token", task.result)
                } else {
                    out.put("token", JSObject.NULL)
                }
                call.resolve(out)
            }
        } catch (e: Exception) {
            val out = extra ?: JSObject()
            out.put("configured", true)
            out.put("permission", permissionState())
            out.put("token", JSObject.NULL)
            call.resolve(out)
        }
    }
}