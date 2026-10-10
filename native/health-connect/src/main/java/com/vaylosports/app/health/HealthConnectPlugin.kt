package com.vaylosports.app.health

import android.content.Intent
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission.Companion.getReadPermission
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.response.ReadRecordsResponse
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * VayloHealthConnect — minimal custom Capacitor plugin.
 *
 * Owns the entire native Health Connect surface for Vaylo Sports (isolated package).
 * Returns normalized, unit-consistent data only; the JS layer never touches
 * Health Connect types. Pull-based: syncs only when the athlete asks, using an
 * incremental cursor (record end-time) — no polling, no background jobs.
 *
 * Method naming note: Capacitor's `Plugin` base class declares final
 * `checkPermissions`/`requestPermissions` plugin-call methods for the legacy
 * runtime-permission system. Health Connect permissions use a different
 * (contract-based) flow, so these methods are deliberately suffixed
 * `PermissionsStatus` to avoid hiding the supertype members.
 *
 * Raw health data is never logged.
 */
@CapacitorPlugin(name = "VayloHealthConnect")
class HealthConnectPlugin : Plugin() {

    private fun status(): Int =
        HealthConnectClient.getSdkStatus(this.context)

    private fun client(): HealthConnectClient =
        HealthConnectClient.getOrCreate(this.context)

    /** Health Connect's API is suspend-only; Capacitor's execute() is a Runnable, not a suspend context. */
    private val hcScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // -- Availability ---------------------------------------------------------

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val s = status()
        call.resolve(
            JSObject().apply {
                put("available", s == HealthConnectClient.SDK_AVAILABLE)
                put("apiStatus", s) // 1=available 2=unavailable 3=reUpdateRequired
            }
        )
    }

    // -- Permissions ----------------------------------------------------------

    @PluginMethod
    fun checkPermissionsStatus(call: PluginCall) {
        if (status() != HealthConnectClient.SDK_AVAILABLE) return call.reject("unavailable")
        hcScope.launch {
            try {
                val grantedSet = client().permissionController.getGrantedPermissions()
                val missing = HealthPermissions.READ_PERMISSIONS - grantedSet
                call.resolve(
                    JSObject().apply {
                        put("granted", jsArray(grantedSet))
                        put("missing", jsArray(missing))
                        put("partial", missing.isNotEmpty() && grantedSet.isNotEmpty())
                        put("version", HealthPermissions.VERSION)
                    }
                )
            } catch (e: Exception) {
                call.reject("check_failed")
            }
        }
    }

    /**
     * Launches the Health Connect permission dialog. The contract's intent is a
     * sentinel that must go through a real ActivityResultLauncher, so we use
     * Capacitor's @ActivityCallback flow (String startActivityForResult overload)
     * rather than a manual requestCode. Result is parsed below.
     */
    @PluginMethod
    fun requestPermissionsStatus(call: PluginCall) {
        if (status() != HealthConnectClient.SDK_AVAILABLE) return call.reject("unavailable")
        val contract = PermissionController.createRequestPermissionResultContract()
        val intent = contract.createIntent(this.context, HealthPermissions.READ_PERMISSIONS)
        startActivityForResult(call, intent, "onHealthPermissionResult")
    }

    @ActivityCallback
    private fun onHealthPermissionResult(call: PluginCall, result: ActivityResult) {
        val data = result.data
        if (data == null) {
            call.resolve(JSObject().apply { put("cancelled", true) })
            return
        }
        val contract = PermissionController.createRequestPermissionResultContract()
        val grantedSet: Set<String> = contract.parseResult(result.resultCode, data)
        val missing = HealthPermissions.READ_PERMISSIONS - grantedSet
        call.resolve(
            JSObject().apply {
                put("granted", jsArray(grantedSet))
                put("missing", jsArray(missing))
                put("denied", missing.isNotEmpty())
            }
        )
    }

    /** Deep-link into Health Connect's app permissions page (manage/revoke). */
    @PluginMethod
    fun openHealthConnectSettings(call: PluginCall) {
        val intent = Intent("androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE")
        try {
            intent.`package` = "com.google.android.apps.healthdata"
            this.context.startActivity(intent)
            call.resolve(JSObject().apply { put("opened", true) })
        } catch (_: Exception) {
            try {
                // Play-store listing for devices without the app (also our install path).
                this.context.startActivity(
                    Intent(Intent.ACTION_VIEW, android.net.Uri.parse("market://details?id=com.google.android.apps.healthdata")),
                )
                call.resolve(JSObject().apply { put("opened", true); put("store", true) })
            } catch (_: Exception) {
                call.resolve(JSObject().apply { put("opened", false) })
            }
        }
    }

    // -- Sync -----------------------------------------------------------------

    /**
     * Pull workouts + samples newer than `sinceMs` (epoch millis of the record
     * end time already synced; null/absent = initial full sync). Sorted, capped
     * by `limit` (default 200) with `hasMore` pagination.
     */
    @PluginMethod
    fun syncPull(call: PluginCall) {
        if (status() != HealthConnectClient.SDK_AVAILABLE) return call.reject("unavailable")
        val sinceMs = if (call.hasOption("sinceMs")) call.getLong("sinceMs") else null
        val limit = (call.getInt("limit") ?: 200).coerceIn(1, 500)

        hcScope.launch {
            try {
                // Permissions may have been revoked since last sync — fail gracefully.
                val hc = client()
                val grantedSet = hc.permissionController.getGrantedPermissions()
                val missing = HealthPermissions.READ_PERMISSIONS - grantedSet
                if (grantedSet.isEmpty()) {
                    call.reject("permission_revoked")
                    return@launch
                }

                val endTimeFilter = sinceMs?.let {
                    TimeRangeFilter.between(java.time.Instant.ofEpochMilli(it), java.time.Instant.now())
                } ?: TimeRangeFilter.between(java.time.Instant.EPOCH, java.time.Instant.now())

                val workouts = mutableListOf<JSObject>()
                var latestCursor: Long? = null
                var hasMore = false

                fun considerCursor(end: Long) {
                    val current = latestCursor
                    if (current == null || end > current) latestCursor = end
                }

                hc.readRecords(
                    ReadRecordsRequest(
                        recordType = ExerciseSessionRecord::class,
                        timeRangeFilter = endTimeFilter,
                        pageSize = limit,
                    )
                ).let { resp: ReadRecordsResponse<ExerciseSessionRecord> ->
                    for (r in resp.records) {
                        workouts.add(workoutJson(hc, grantedSet, r))
                        considerCursor(r.endTime.toEpochMilli())
                    }
                    hasMore = hasMore || resp.pageToken != null
                }

                // Independent metric streams (steps / sleep) that exist outside sessions.
                val samples = mutableListOf<JSObject>()
                hc.readRecords(
                    ReadRecordsRequest(StepsRecord::class, endTimeFilter, pageSize = limit)
                ).let { resp ->
                    for (r in resp.records) {
                        samples.add(
                            JSObject().apply {
                                put("sourceRecordId", r.metadata.id)
                                put("metric", "steps")
                                put("startTime", r.startTime.toString())
                                put("endTime", r.endTime.toString())
                                put("value", r.count)
                                put("unit", "count")
                            }
                        )
                        considerCursor(r.endTime.toEpochMilli())
                    }
                    hasMore = hasMore || resp.pageToken != null
                }

                hc.readRecords(
                    ReadRecordsRequest(SleepSessionRecord::class, endTimeFilter, pageSize = limit)
                ).let { resp ->
                    for (r in resp.records) {
                        samples.add(
                            JSObject().apply {
                                put("sourceRecordId", r.metadata.id)
                                put("metric", "sleep")
                                put("startTime", r.startTime.toString())
                                put("endTime", r.endTime.toString())
                                put("value", JSONObject.NULL)
                                put("unit", "seconds")
                                put("stage", JSONObject.NULL)
                                put("durationSeconds", (r.endTime.toEpochMilli() - r.startTime.toEpochMilli()) / 1000)
                            }
                        )
                        considerCursor(r.endTime.toEpochMilli())
                    }
                    hasMore = hasMore || resp.pageToken != null
                }

                call.resolve(
                    JSObject().apply {
                        put("workouts", jsArray(workouts))
                        put("samples", jsArray(samples))
                        put("latestCursorMs", latestCursor ?: JSONObject.NULL)
                        put("hasMore", hasMore)
                    }
                )
            } catch (e: SecurityException) {
                call.reject("permission_revoked")
            } catch (e: Exception) {
                // Never log raw health data; log only the failure class.
                android.util.Log.w("VayloHealth", "syncPull failed: ${e.javaClass.simpleName}")
                call.reject("sync_failed")
            }
        }
    }

    // -- Normalizers ----------------------------------------------------------

    /** One workout + the aggregates Health Connect already groups per session. */
    private suspend fun workoutJson(
        hc: HealthConnectClient,
        grantedSet: Set<String>,
        r: ExerciseSessionRecord,
    ): JSObject {
        val start = r.startTime
        val end = r.endTime
        val range = TimeRangeFilter.between(start, end)

        // Aggregates Health Connect groups per session, guarded by per-type grants.
        var distanceMeters: Double? = null
        var calories: Double? = null
        var hrAvg: Double? = null
        var hrMax: Double? = null
        var hrMin: Double? = null
        var steps: Long? = null

        if (grantedSet.contains(getReadPermission(DistanceRecord::class))) {
            hc.readRecords(ReadRecordsRequest(DistanceRecord::class, range)).records.firstOrNull()?.let {
                distanceMeters = it.distance.inMeters
            }
        }
        if (grantedSet.contains(getReadPermission(TotalCaloriesBurnedRecord::class))) {
            hc.readRecords(ReadRecordsRequest(TotalCaloriesBurnedRecord::class, range)).records.firstOrNull()?.let {
                calories = it.energy.inKilocalories
            }
        }
        if (grantedSet.contains(getReadPermission(HeartRateRecord::class))) {
            hc.readRecords(ReadRecordsRequest(HeartRateRecord::class, range)).records.firstOrNull()?.let { hr ->
                val all = hr.samples.map { it.beatsPerMinute }
                if (all.isNotEmpty()) {
                    hrAvg = all.average()
                    hrMax = all.max().toDouble()
                    hrMin = all.min().toDouble()
                }
            }
        }
        if (grantedSet.contains(getReadPermission(StepsRecord::class))) {
            hc.readRecords(ReadRecordsRequest(StepsRecord::class, range)).records.firstOrNull()?.let {
                steps = it.count
            }
        }

        return JSObject().apply {
            put("sourceRecordId", r.metadata.id)
            put("title", r.title)
            put("activityType", r.exerciseType.toString())
            put("startTime", start.toString())
            put("endTime", end.toString())
            put("durationSeconds", (end.toEpochMilli() - start.toEpochMilli()) / 1000)
            put("distanceMeters", distanceMeters)
            put("activeCalories", calories)
            put("heartRateAvg", hrAvg)
            put("heartRateMax", hrMax)
            put("heartRateMin", hrMin)
            put("steps", steps)
        }
    }

    /** JSArray from a collection — avoids the KT-48162 spread-on-non-vararg error. */
    private fun jsArray(items: Collection<*>): JSArray = JSArray(items)

}
