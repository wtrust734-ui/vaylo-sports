package com.vaylosports.app.push

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Receives pushes while the WebView is not running.
 *
 * This is the part that makes delivery real. A message that is only rendered by
 * JavaScript in the page does not arrive at all when the app is closed, swiped
 * away, or killed for memory — which on Android is most of the time. The
 * notification is therefore built and posted natively here, from the data
 * payload, with no WebView and no JavaScript involved.
 *
 * Token rotation is handled here too. FCM reissues tokens, and an app that
 * ignores onNewToken keeps sending to an address that no longer exists: the
 * send silently succeeds and the athlete hears nothing. The new token is
 * cached here and read by the JS layer the next time the app opens, which is
 * the only moment it can be stored against an authenticated account — the
 * service runs without a session.
 */
class VayloMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        // No account context here, so this is only a cache. src/lib/push.ts
        // drains it on sign-in and re-registers.
        try {
            getSharedPreferences(PushBridge.PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(PushBridge.KEY_TOKEN, token)
                .apply()
        } catch (e: Exception) {
            // Nothing useful to do; the next onNewToken will try again.
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val title = data["title"] ?: message.notification?.title
        val body = data["body"] ?: message.notification?.body
        if (title.isNullOrEmpty()) return

        val channel = if (data["channel"] == PushChannels.REMINDERS_ID) {
            PushChannels.REMINDERS_ID
        } else {
            PushChannels.DEFAULT_ID
        }

        // From API 33 the runtime permission is required even to post, and the
        // athlete can revoke it at any time. Posting without it throws.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        try {
            val launch = packageManager.getLaunchIntentForPackage(packageName)
            val pending = PendingIntent.getActivity(
                this,
                // A stable request code: a per-message code would grow the
                // PendingIntent pool without bound as messages arrive.
                1001,
                launch,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val notification = NotificationCompat.Builder(this, channel)
                .setSmallIcon(android.R.drawable.stat_notify_more)
                .setContentTitle(title)
                .setContentText(body ?: "")
                .setStyle(NotificationCompat.BigTextStyle().bigText(body ?: ""))
                .setAutoCancel(true)
                .setContentIntent(pending)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build()

            val manager = getSystemService(NotificationManager::class.java)
            // Derived from the message id where there is one, so a retry of the
            // same message updates its notification instead of stacking a
            // second copy.
            val id = (data["id"] ?: title).hashCode()
            manager?.notify(id, notification)
        } catch (e: Exception) {
            // A failed post must not crash the service.
        }
    }
}