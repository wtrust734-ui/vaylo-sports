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
        // Any one of them missing means the placeholders are still in place.
        if (appId.isEmpty() || apiKey.isEmpty() || projectId.isEmpty() || senderId.isEmpty()) return false

        return try {
            val options = FirebaseOptions.Builder()
                .setApplicationId(appId)
                .setApiKey(apiKey)
                .setProjectId(projectId)
                .setGcmSenderId(senderId)
                .build()
            FirebaseApp.initializeApp(ctx, options)
            true
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

        // Reminders are the quiet-hours case: LOW importance so a streak alert
        // does not buzz the phone at 6am — which is what this comment always
        // claimed and what the channel did not actually do.
        //
        // Channel metadata is frozen the first time an id is created: Android
        // ignores a later createNotificationChannel() for the same id, including
        // a different importance, and the athlete can only change it in system
        // settings afterwards. src/lib/localNotifications.ts creates this same
        // id from the WebView side, so the two definitions have to agree and both
        // have to be right the first time. This one is the definition: the plugin
        // registers — and so creates the channel — before any reminder can be
        // scheduled.
        val reminders = NotificationChannel(
            PushChannels.REMINDERS_ID,
            "Workout reminders",
            NotificationManager.IMPORTANCE_LOW
        )
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
     * Drops this device's registration: the FCM token, and the copy cached for
     * the next sign-in.
     *
     * Sign-out has to reach this: a phone that keeps its token after the athlete
     * signs out will keep receiving the next account's notifications on a
     * handset they may have handed to somebody else.
     *
     * Two halves, and the plugin can only do one of them honestly. The server row
     * is deleted by src/lib/push.ts, which holds the athlete's session; the plugin
     * has no credentials and could not tell whose registration it was. What the
     * plugin owns is the device side — deleteToken() stops this install receiving
     * anything, and clearing the cache stops the stale token being re-registered
     * on the next sign-in. It used to resolve an empty object and do neither,
     * while this comment claimed otherwise.
     */
    @PluginMethod
    fun unregister(call: PluginCall) {
        clearCachedToken()

        if (!ensureFirebase()) {
            // Push was never configured, so there is no token to delete. Said
            // rather than implied: the caller can still delete its server row.
            call.resolve(
                JSObject().apply {
                    put("configured", false)
                    put("deleted", false)
                }
            )
            return
        }

        try {
            FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener { task ->
                call.resolve(
                    JSObject().apply {
                        put("configured", true)
                        put("deleted", task.isSuccessful)
                    }
                )
            }
        } catch (e: Exception) {
            // Never rejects: signing out must not be blocked by push.
            call.resolve(
                JSObject().apply {
                    put("configured", true)
                    put("deleted", false)
                }
            )
        }
    }

    /** Forget the token cached by onNewToken for the next sign-in to re-register. */
    private fun clearCachedToken() {
        runCatching {
            ctx.getSharedPreferences(PushBridge.PREFS, Context.MODE_PRIVATE)
                .edit()
                .remove(PushBridge.KEY_TOKEN)
                .apply()
        }
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