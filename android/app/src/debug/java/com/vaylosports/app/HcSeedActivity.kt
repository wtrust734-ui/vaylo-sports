package com.vaylosports.app

import android.os.Bundle
import android.util.Log
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.units.Energy
import androidx.health.connect.client.units.Length
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * Debug-only seeder — inserts one synthetic workout + ambient records via
 * HealthConnectClient so Task 1 can be verified end-to-end (emulator HC →
 * Vaylo sync → Supabase rows). Present only in the debug build type.
 *
 * Launch:  adb shell am start -n com.vaylosports.app/.HcSeedActivity
 * Verify:  adb logcat -s HcSeed
 */
class HcSeedActivity : ComponentActivity() {

    private val tag = "HcSeed"

    // WRITE permissions the seeder needs; must match the debug manifest.
    private val needed = setOf(
        "android.permission.health.WRITE_EXERCISE",
        "android.permission.health.WRITE_STEPS",
        "android.permission.health.WRITE_DISTANCE",
        "android.permission.health.WRITE_TOTAL_CALORIES_BURNED",
        "android.permission.health.WRITE_HEART_RATE",
        "android.permission.health.WRITE_SLEEP",
    )

    private lateinit var status: TextView

    private val requestLauncher =
        registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { granted ->
            if (needed.all { it in granted }) {
                insert()
            } else {
                val missing = (needed - granted).joinToString()
                val msg = "WRITE permissions not granted — missing: $missing"
                Log.w(tag, msg)
                status.text = msg
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        status = TextView(this).apply {
            text = "HC seeder: checking…"
            textSize = 14f
            setPadding(32, 48, 32, 32)
        }
        setContentView(status)
        checkAndInsert()
    }

    private fun checkAndInsert() {
        val s = HealthConnectClient.getSdkStatus(this)
        if (s != HealthConnectClient.SDK_AVAILABLE) {
            val msg = "Health Connect not available (status=$s)"
            Log.w(tag, msg)
            status.text = msg
            return
        }
        lifecycleScope.launch {
            try {
                val client = HealthConnectClient.getOrCreate(this@HcSeedActivity)
                val granted = client.permissionController.getGrantedPermissions()
                if (needed.all { it in granted }) insert() else {
                    status.text = "Requesting WRITE permissions…"
                    requestLauncher.launch(needed)
                }
            } catch (e: Exception) {
                val msg = "Permission check failed: ${e.message}"
                Log.w(tag, msg, e)
                status.text = msg
            }
        }
    }

    private fun insert() {
        status.text = "Inserting workout + samples…"
        lifecycleScope.launch {
            try {
                val client = HealthConnectClient.getOrCreate(this@HcSeedActivity)

                // Deterministic windows relative to device clock: a 30-min run ending
                // ~1h ago + a sleep record for last night. The Vaylo sync's
                // incremental cursor is an end-time, so \"ended recently\" guarantees
                // the seeded workout is newer than the last cursor on any account.
                val now = Instant.now()
                val runEnd = now.minus(1, ChronoUnit.HOURS)
                val runStart = runEnd.minus(30, ChronoUnit.MINUTES)
                val sleepEnd = runStart.minus(30, ChronoUnit.MINUTES)
                val sleepStart = sleepEnd.minus(7, ChronoUnit.HOURS).minus(30, ChronoUnit.MINUTES)

                // exerciseType=RUNTIME int; RUNNING=56 on this HC version (same id the
                // sync layer persists as activity_type). Title/distance/calories/steps
                // chosen to be trivially recognisable in DB spot-checks.
                val session = ExerciseSessionRecord(
                    startTime = runStart,
                    startZoneOffset = null,
                    endTime = runEnd,
                    endZoneOffset = null,
                    exerciseType = 56,
                    title = "Vaylo Seed Run (debug)",
                    notes = null,
                )

                // Each aggregate is a separate HC record overlapping the session window;
                // the sync layer reads them per-session via TimeRangeFilter(start,end).
                val distance = DistanceRecord(
                    startTime = runStart, startZoneOffset = null,
                    endTime = runEnd, endZoneOffset = null,
                    distance = Length.kilometers(5.2),
                )
                val calories = TotalCaloriesBurnedRecord(
                    startTime = runStart, startZoneOffset = null,
                    endTime = runEnd, endZoneOffset = null,
                    energy = Energy.kilocalories(348.0),
                )
                val steps = StepsRecord(
                    startTime = runStart, startZoneOffset = null,
                    endTime = runEnd, endZoneOffset = null,
                    count = 6_420,
                )

                // Five evenly-spaced HR samples inside the session.
                val hrSamples = listOf(132L, 148L, 162L, 155L, 141L).mapIndexed { i, bpm ->
                    HeartRateRecord.Sample(
                        time = runStart.plusSeconds((i * 360).toLong()),
                        beatsPerMinute = bpm,
                    )
                }
                val hr = HeartRateRecord(
                    startTime = runStart, startZoneOffset = null,
                    endTime = runEnd, endZoneOffset = null,
                    samples = hrSamples,
                )

                val sleep = SleepSessionRecord(
                    startTime = sleepStart, startZoneOffset = null,
                    endTime = sleepEnd, endZoneOffset = null,
                    title = "Vaylo Seed Sleep",
                    notes = null,
                )

                client.insertRecords(listOf(session, distance, calories, steps, hr, sleep))

                val msg = "Inserted: 1 run (5.2km, 348kcal, 6420 steps, hr 132..162), 1 sleep. " +
                    "run=[${runStart} → ${runEnd}], sleep=[${sleepStart} → ${sleepEnd}]"
                Log.i(tag, msg)
                status.text = msg
            } catch (e: Exception) {
                val msg = "Insert failed: ${e.javaClass.simpleName}: ${e.message}"
                Log.e(tag, msg, e)
                status.text = msg
            }
        }
    }
}
