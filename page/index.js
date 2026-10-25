import { WorkoutStateMachine, STATES } from '../utils/state-machine'
import { WorkoutTimer } from '../utils/timer'
import { saveWorkoutToDisk, loadWorkoutFromDisk, clearWorkoutFromDisk } from '../utils/storage'

let appLogger = null
try {
  if (typeof DeviceRuntimeCore !== 'undefined' && DeviceRuntimeCore.HmLogger) {
    appLogger = DeviceRuntimeCore.HmLogger.getLogger('Anduin')
  } else if (typeof Logger !== 'undefined' && typeof Logger.getLogger === 'function') {
    appLogger = Logger.getLogger('Anduin')
  }
} catch (e) {}

function formatLogTime() {
  const d = new Date()
  const pad = n => (n < 10 ? '0' + n : n)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function logDevice(...args) {
  const time = formatLogTime()
  const str = `[${time}] ` + args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
  console.log(str)
}

Page({
  state: {
    telemetry: {
      screenOffCount: 0,
      restoreCount: 0,
      totalSleepSeconds: 0,
      lastSleepDurationSec: 0,
      lastSleepTimestamp: 0,
      lastWakeTimestamp: 0
    },
    stateMachine: null,
    timer: null,
    heartSensor: null,
    heartRate: 0,
    accelSensor: null,
    lastAutoLapTime: 0,
    strokesThisLap: 0,
    totalStrokes: 0,
    lastStrokeTime: 0,
    lastAccelZ: 0,
    currentScreen: 0, // 0: CRONÓMETRO, 1: PARCIALES (LAPS), 2: AJUSTES / SALIR
    lapScrollOffset: 0,
    lastKeyEventTime: 0,
    ignoreKeysUntil: 0, // Cooldown to block key events when returning from system notifications
    bottomCardMode: 0, // 0: Sesión, 1: SWOLF, 2: Pulso/Recuperación, 3: Último Set
    restStartHeartRate: 0,
    peakHeartRate: 0,
    lastRecoveryBpm: 0,
    savedBrightness: null,
    savedAutoBright: null,
    timeSensor: null,
    timerData: {
      formattedTotal: '00:00',
      formattedLap: '00:00',
      formattedRest: '00:00',
      formattedTotalRest: '00:00',
      totalSeconds: 0,
      lapSeconds: 0,
      restSeconds: 0,
      totalRestSeconds: 0,
      isResting: false,
      poolLength: 25,
      totalMeters: 0,
      avgPace100m: '--:--',
      currentLapNumber: 1,
      totalLaps: 0,
      laps: [],
      lastLap: null
    },
    widgets: {},
    diagChunks: [],
    diagChunkIndex: 0
  },

  keepScreenAwake() {
    // 1. REA Hack: Emulate Amazfit Native Workout Persistent Screen On via System Properties
    if (typeof hmFS !== 'undefined') {
      try {
        if (typeof hmFS.SysProSetBool === 'function') {
          hmFS.SysProSetBool('settings_switch_screen_constant_bright_on_sport', true)
          hmFS.SysProSetBool('settings_switch_screen_auto_bright', false)
          
          // DND & Notif Wake Suppression: Mute all incoming notifications and disable screen wake on alerts
          if (this.state.savedDndSwitch === undefined && typeof hmFS.SysProGetBool === 'function') {
            this.state.savedDndSwitch = hmFS.SysProGetBool('settings_switch_dnd')
          }
          if (this.state.savedScreenNotifyBright === undefined && typeof hmFS.SysProGetBool === 'function') {
            this.state.savedScreenNotifyBright = hmFS.SysProGetBool('settings_switch_screen_nofity_bright')
          }
          hmFS.SysProSetBool('settings_switch_dnd', true)
          hmFS.SysProSetBool('settings_switch_screen_nofity_bright', false)
        }
        if (typeof hmFS.SysProSetInt === 'function') {
          // Backup original user screen duration once
          if (this.state.savedScreenDuration === undefined && typeof hmFS.SysProGetInt === 'function') {
            this.state.savedScreenDuration = hmFS.SysProGetInt('settings_data_screen_duration')
          }
          // Set global screen duration to 1 hour (3600 seconds)
          hmFS.SysProSetInt('settings_data_screen_duration', 3600)
          hmFS.SysProSetInt('settings_dis_bright_time', 3600)
        }
        if (!this.state.hasLoggedReaHack) {
          this.state.hasLoggedReaHack = true
          logDevice('[REA HACK] Constant Bright on Sport = TRUE | Screen Duration = 3600s | DND = TRUE | Screen Notify Wake = FALSE')
        }
      } catch (e) {
        console.log('[REA HACK ERROR]:', e)
      }
    }

    // 2. Keep App in foreground (Zepp OS default screen guard)
    if (typeof hmApp !== 'undefined') {
      if (typeof hmApp.setScreenKeep === 'function') {
        try { hmApp.setScreenKeep(true) } catch (e) {}
      }
      if (typeof hmApp.pauseDropWristScreenOff === 'function') {
        try { hmApp.pauseDropWristScreenOff({ duration: 0 }) } catch (e) {}
      }
    }

    // 3. Hardware Wake Lock refresh (300 seconds window renewed continuously)
    if (typeof hmSetting !== 'undefined') {
      if (typeof hmSetting.setBrightScreen === 'function') {
        try { hmSetting.setBrightScreen(300) } catch (e) {}
      }
      // NATIVE GTR 3 PRO API DISCOVERED VIA DEVICE LOGS:
      if (typeof hmSetting.stopWristDownOff === 'function') {
        try { hmSetting.stopWristDownOff() } catch (e) {}
        try { hmSetting.stopWristDownOff({ duration: 3600000 }) } catch (e) {}
        try { hmSetting.stopWristDownOff(3600) } catch (e) {}
      }
      if (typeof hmSetting.stopPalmOff === 'function') {
        try { hmSetting.stopPalmOff() } catch (e) {}
        try { hmSetting.stopPalmOff({ duration: 3600000 }) } catch (e) {}
        try { hmSetting.stopPalmOff(3600) } catch (e) {}
      }
      if (!this.state.hasLoggedWristDownStop) {
        this.state.hasLoggedWristDownStop = true
        logDevice('[WRIST] stopWristDownOff() & stopPalmOff() INVOCADOS CON ÉXITO!')
      }
    }
  },

  build() {
    console.log('Building Pro Swimming Multi-Screen App for Amazfit GTR 3 Pro')
    
    // 1. FORZAR PANTALLA PRENDIDA y retener app
    this.keepScreenAwake()




    // 3. Disable touch gestures (prevents water drops causing ghost swipes or exits)
    if (typeof hmApp !== 'undefined' && typeof hmApp.gestureEnabled === 'function') {
      try {
        hmApp.gestureEnabled(false)
      } catch (e) {
        console.log('Gesture disable error:', e)
      }
    }

    this.initStateMachine()
    this.initTimer()
    this.initHeartRate()
    this.initAccelerometer()
    this.createUI()
    this.registerPhysicalKeys()
    this.registerSpinListener()
    this.restoreActiveWorkout()
    this.switchScreen(0)
    this.updateUI()
  },

  onShow() {
    const now = Date.now()
    if (!this.state.telemetry) {
      this.state.telemetry = { screenOffCount: 0, restoreCount: 0, totalSleepSeconds: 0, lastSleepDurationSec: 0 }
    }
    this.state.telemetry.restoreCount = (this.state.telemetry.restoreCount || 0) + 1
    this.state.telemetry.lastWakeTimestamp = now

    let elapsed = 0
    if (this.state.hideTime) {
      elapsed = Math.floor((now - this.state.hideTime) / 1000)
      this.state.telemetry.lastSleepDurationSec = elapsed
      this.state.telemetry.totalSleepSeconds = (this.state.telemetry.totalSleepSeconds || 0) + elapsed
    }

    logDevice(`[TELEMETRY] [WAKE] Pantalla restaurada #${this.state.telemetry.restoreCount} | Estuvo dormido: ${elapsed}s | Total sleep: ${this.state.telemetry.totalSleepSeconds}s`)

    // Prevent the crown button press used to dismiss WhatsApp from clicking inside Anduin!
    this.state.ignoreKeysUntil = now + 1000

    this.keepScreenAwake()

    if (typeof timer !== 'undefined' && typeof timer.createTimer === 'function') {
      if (this.state.screenKeepTimer) {
        try { timer.stopTimer(this.state.screenKeepTimer) } catch (e) {}
      }
      this.state.screenKeepTimer = timer.createTimer(
        1000,
        1500,
        () => {
          this.keepScreenAwake()
        },
        {}
      )
    }

    if (typeof hmApp !== 'undefined') {
      if (typeof hmApp.gestureEnabled === 'function') {
        try { hmApp.gestureEnabled(false) } catch (e) {}
      }
    }

    const curState = this.state.stateMachine ? this.state.stateMachine.getState() : STATES.READY
    
    // Catch up any time spent in background/notification overlay without losing seconds
    if (elapsed > 0 && elapsed < 7200 && this.state.timer) {
      if (curState === STATES.RUNNING) {
        this.state.timer.totalSeconds = (this.state.timer.totalSeconds || 0) + elapsed
        this.state.timer.lapSeconds = (this.state.timer.lapSeconds || 0) + elapsed
        this.state.timer.intervalSeconds = (this.state.timer.intervalSeconds || 0) + elapsed
      } else if (curState === STATES.PAUSED) {
        this.state.timer.restSeconds = (this.state.timer.restSeconds || 0) + elapsed
        this.state.timer.totalRestSeconds = (this.state.timer.totalRestSeconds || 0) + elapsed
      }
    }
    this.state.hideTime = null

    if (curState === STATES.RUNNING) {
      if (this.state.timer) {
        this.state.timer.lastTickTime = Date.now()
        if (!this.state.timer.timerId) {
          this.state.timer.resume()
        }
      }
    } else if (curState === STATES.PAUSED) {
      if (this.state.timer) {
        this.state.timer.lastTickTime = Date.now()
        if (!this.state.timer.timerId) {
          this.state.timer.start()
          this.state.timer.isResting = true
        }
      }
    }
    if (this.state.currentScreen === 2) {
      this.renderSettingsScreen()
    } else {
      this.updateUI()
    }
  },

  onHide() {
    const now = Date.now()
    if (!this.state.telemetry) {
      this.state.telemetry = { screenOffCount: 0, restoreCount: 0, totalSleepSeconds: 0, lastSleepDurationSec: 0 }
    }
    this.state.telemetry.screenOffCount = (this.state.telemetry.screenOffCount || 0) + 1
    this.state.telemetry.lastSleepTimestamp = now
    this.state.hideTime = now
    this.persistWorkoutState()
    const curState = this.state.stateMachine ? this.state.stateMachine.getState() : STATES.READY
    const tData = this.state.timerData || {}
    logDevice(`[TELEMETRY] [OFF] Pantalla apagada #${this.state.telemetry.screenOffCount} | Estado: ${curState} | Tiempo: ${tData.formattedTotal || '00:00'} | Lap: ${tData.currentLapNumber || 1}`)
  },

  persistWorkoutState() {
    try {
      const curState = this.state.stateMachine ? this.state.stateMachine.getState() : STATES.READY
      if (curState !== STATES.READY) {
        const payload = {
          state: curState,
          timestamp: Date.now(),
          timerData: this.state.timer ? this.state.timer.serialize() : null,
          totalStrokes: this.state.totalStrokes || 0,
          peakHeartRate: this.state.peakHeartRate || 0,
          lastRecoveryBpm: this.state.lastRecoveryBpm || 0
        }
        // Save to persistent flash storage (survives app kill / notification overlay)
        saveWorkoutToDisk(payload)
        const app = typeof getApp === 'function' ? getApp() : null
        if (app && app.globalData) {
          app.globalData.activeWorkout = payload
        }
      } else {
        clearWorkoutFromDisk()
        const app = typeof getApp === 'function' ? getApp() : null
        if (app && app.globalData) {
          app.globalData.activeWorkout = null
        }
      }
    } catch (e) {
      console.log('persistWorkoutState error:', e)
    }
  },

  restoreActiveWorkout() {
    try {
      // 1. Try disk storage first (survives OS app kills)
      let saved = loadWorkoutFromDisk()
      // 2. Fallback to RAM globalData
      if (!saved) {
        const app = typeof getApp === 'function' ? getApp() : null
        saved = app && app.globalData ? app.globalData.activeWorkout : null
      }

      if (saved && saved.timerData && saved.state && saved.state !== STATES.READY) {
        console.log('Restoring active workout from disk/interruption:', saved.state)
        
        // Calculate seconds elapsed while app was hidden/interrupted
        const elapsedSecs = Math.floor((Date.now() - (saved.timestamp || Date.now())) / 1000)
        if (elapsedSecs > 0 && elapsedSecs < 7200) { // within 2 hours
          if (saved.state === STATES.RUNNING) {
            saved.timerData.totalSeconds = (saved.timerData.totalSeconds || 0) + elapsedSecs
            saved.timerData.lapSeconds = (saved.timerData.lapSeconds || 0) + elapsedSecs
            saved.timerData.intervalSeconds = (saved.timerData.intervalSeconds || 0) + elapsedSecs
          } else if (saved.state === STATES.PAUSED) {
            saved.timerData.restSeconds = (saved.timerData.restSeconds || 0) + elapsedSecs
            saved.timerData.totalRestSeconds = (saved.timerData.totalRestSeconds || 0) + elapsedSecs
          }
        }

        this.state.timer.deserialize(saved.timerData)
        this.state.totalStrokes = saved.totalStrokes || 0
        this.state.peakHeartRate = saved.peakHeartRate || 0
        this.state.lastRecoveryBpm = saved.lastRecoveryBpm || 0
        this.state.stateMachine.setState(saved.state)
        
        // 1-second key ignore so the crown click that closed WhatsApp doesn't click in Anduin
        this.state.ignoreKeysUntil = Date.now() + 1000

        if (saved.state === STATES.RUNNING) {
          this.state.timer.resume()
        } else if (saved.state === STATES.PAUSED) {
          this.state.timer.isResting = true
          if (!this.state.timer.timerId) {
            this.state.timer.start()
            this.state.timer.isResting = true
          }
        }
      }
    } catch (e) {
      console.log('Restore workout error:', e)
    }
  },

  onDestroy() {
    console.log('Destroying Swimming Page (Interruption or Exit)')
    // Always persist state
    this.persistWorkoutState()

    // If it's an OS interruption (e.g. WhatsApp notification, incoming call, quick overlay)
    // and NOT an explicit user exit from Screen 2, NEVER disable setScreenKeep or cancel bright screen!
    if (!this.state.isExplicitExit) {
      console.log('Interruption occurred (notification/overlay) - preserving screenKeep and keepAwake')
      return
    }


    if (this.state.screenKeepTimer) {
      try { timer.stopTimer(this.state.screenKeepTimer) } catch (e) {}
      this.state.screenKeepTimer = null
    }

    if (typeof hmApp !== 'undefined') {
      if (typeof hmApp.setScreenKeep === 'function') {
        try { hmApp.setScreenKeep(false) } catch (e) {}
      }
      if (typeof hmApp.gestureEnabled === 'function') {
        try { hmApp.gestureEnabled(true) } catch (e) {}
      }
    }

    if (this.state.timer && typeof this.state.timer.stopTicking === 'function') {
      this.state.timer.stopTicking()
    }

    if (this.state.heartSensor && typeof this.state.heartSensor.removeEventListener === 'function') {
      try {
        this.state.heartSensor.removeEventListener(hmSensor.event.CHANGE)
      } catch (e) {
        console.log('Remove heart listener error:', e)
      }
    }

    if (this.state.accelSensor && typeof this.state.accelSensor.stop === 'function') {
      try {
        this.state.accelSensor.stop()
      } catch (e) {
        console.log('Stop accel error:', e)
      }
    }

    if (typeof hmApp !== 'undefined') {
      if (typeof hmApp.unregisterKeyEvent === 'function') {
        try {
          hmApp.unregisterKeyEvent()
        } catch (e) {
          console.log('Unregister key error:', e)
        }
      }
      if (typeof hmApp.unregisterSpinEvent === 'function') {
        try {
          hmApp.unregisterSpinEvent()
        } catch (e) {
          console.log('Unregister spin error:', e)
        }
      }
    }

    // Cancel forced bright screen and restore system properties on final clean exit
    if (typeof hmSetting !== 'undefined') {
      try {
        if (typeof hmSetting.setBrightScreenCancel === 'function') {
          hmSetting.setBrightScreenCancel()
        }
        if (typeof hmSetting.releaseWristDownOff === 'function') {
          hmSetting.releaseWristDownOff()
        }
        if (typeof hmSetting.releasePalmOff === 'function') {
          hmSetting.releasePalmOff()
        }
      } catch (e) {
        console.log('Cancel bright screen error:', e)
      }
    }

    if (typeof hmFS !== 'undefined') {
      try {
        if (typeof hmFS.SysProSetBool === 'function') {
          hmFS.SysProSetBool('settings_switch_screen_constant_bright_on_sport', false)
          if (this.state.savedDndSwitch !== undefined) {
            hmFS.SysProSetBool('settings_switch_dnd', this.state.savedDndSwitch)
          }
          if (this.state.savedScreenNotifyBright !== undefined) {
            hmFS.SysProSetBool('settings_switch_screen_nofity_bright', this.state.savedScreenNotifyBright)
          }
        }
        if (typeof hmFS.SysProSetInt === 'function') {
          const restoreDur = (this.state.savedScreenDuration !== undefined && this.state.savedScreenDuration > 0) ? this.state.savedScreenDuration : 15
          hmFS.SysProSetInt('settings_data_screen_duration', restoreDur)
        }
      } catch (e) {
        console.log('Restore SysPro error:', e)
      }
    }
  },

  vibrate(type = 'short') {
    try {
      if (typeof hmSensor === 'undefined' || typeof hmSensor.createSensor !== 'function') return
      const v = hmSensor.createSensor(hmSensor.id.VIBRATE)
      if (!v) return

      if (type === 'short') {
        v.scene = 25 // short strong pulse
      } else if (type === 'double') {
        v.scene = 0 // two short notification pulses
      } else if (type === 'long') {
        v.scene = 27 // long duration pulse
      }
      v.start()
    } catch (e) {
      console.log('Vibrate error:', e)
    }
  },

  getCurrentTimeText() {
    try {
      if (typeof hmSensor !== 'undefined' && typeof hmSensor.createSensor === 'function') {
        if (!this.state.timeSensor) {
          this.state.timeSensor = hmSensor.createSensor(hmSensor.id.TIME)
        }
        const s = this.state.timeSensor
        if (s && typeof s.hour !== 'undefined') {
          const hh = String(s.hour).padStart(2, '0')
          const mm = String(s.minute || 0).padStart(2, '0')
          return `${hh}:${mm}`
        }
      }
      const d = new Date()
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      return `${hh}:${mm}`
    } catch (e) {
      return '--:--'
    }
  },

  uploadWorkoutToIntervals() {
    try {
      const app = typeof getApp === 'function' ? getApp() : null
      let mb = null
      if (app) {
        if (app.globalData && app.globalData.messageBuilder) {
          mb = app.globalData.messageBuilder
        } else if (app._options && app._options.globalData && app._options.globalData.messageBuilder) {
          mb = app._options.globalData.messageBuilder
        }
      }

      if (!mb) {
        logDevice('[UPLOAD] MessageBuilder no disponible en globalData')
        return
      }

      const workoutTimer = this.state.timer
      if (!workoutTimer) return

      const stats = workoutTimer.getStats ? workoutTimer.getStats() : {}
      const data = this.state.timerData || {}
      const payload = {
        startTime: workoutTimer.startTime || Date.now(),
        totalSeconds: data.totalSeconds || 0,
        totalRestSeconds: data.totalRestSeconds || 0,
        totalMeters: data.totalMeters || 0,
        poolLength: data.poolLength || 25,
        formattedTotal: data.formattedTotal || '00:00',
        formattedTotalRest: data.formattedTotalRest || '00:00',
        avgPace100m: data.avgPace100m || '--:--',
        avgSwolf: stats.avgSwolf || '--',
        calories: stats.calories || 0,
        heartRate: this.state.heartRate || 0,
        peakHeartRate: this.state.peakHeartRate || 0,
        lastRecoveryBpm: this.state.lastRecoveryBpm || 0,
        laps: workoutTimer.getLaps ? workoutTimer.getLaps() : []
      }

      this.state.uploadStatus = 'uploading'
      logDevice(`[UPLOAD] Enviando sesión (${payload.totalMeters}m, ${payload.laps.length} vueltas) a Intervals.icu...`)

      if (this.state.currentScreen === 2) {
        this.renderSettingsScreen()
      }

      // Safety timeout timer (12s): ensures UI NEVER hangs indefinitely if phone BLE is slow/asleep
      if (this.uploadSafetyTimer && typeof timer !== 'undefined' && timer.stopTimer) {
        timer.stopTimer(this.uploadSafetyTimer)
        this.uploadSafetyTimer = null
      }
      if (typeof timer !== 'undefined' && timer.createTimer) {
        this.uploadSafetyTimer = timer.createTimer(
          12000,
          0,
          () => {
            this.uploadSafetyTimer = null
            if (this.state.uploadStatus === 'uploading') {
              logDevice('[UPLOAD] Tiempo de espera agotado (12s). Podés pulsar el botón para reintentar.')
              this.state.uploadStatus = 'error'
              this.vibrate('short')
              if (this.state.currentScreen === 2) {
                this.renderSettingsScreen()
              }
            }
          },
          {}
        )
      }

      const clearSafety = () => {
        if (this.uploadSafetyTimer && typeof timer !== 'undefined' && timer.stopTimer) {
          timer.stopTimer(this.uploadSafetyTimer)
          this.uploadSafetyTimer = null
        }
      }

      mb.request({
        method: 'UPLOAD_TO_INTERVALS',
        params: payload
      }, { timeout: 12000 })
        .then(res => {
          clearSafety()
          const resData = res && res.data ? res.data : res
          if (resData && resData.success) {
            this.state.uploadStatus = 'success'
            logDevice('[UPLOAD] ¡Sesión sincronizada con éxito en Intervals.icu!')
            this.vibrate('double')
          } else {
            this.state.uploadStatus = 'error'
            const err = (resData && resData.error) ? resData.error : 'Fallo'
            logDevice('[UPLOAD ERROR] ' + err)
          }
          if (this.state.currentScreen === 2) {
            this.renderSettingsScreen()
          }
        })
        .catch(err => {
          clearSafety()
          this.state.uploadStatus = 'error'
          console.log('[UPLOAD CATCH ERROR]:', err)
          if (this.state.currentScreen === 2) {
            this.renderSettingsScreen()
          }
        })
    } catch (e) {
      console.log('uploadWorkoutToIntervals exception:', e)
      logDevice('[UPLOAD ERROR] Excepción: ' + (e && e.message ? e.message : e))
    }
  },

  getHeartRateZone(bpm) {
    if (!bpm || bpm <= 0) {
      return { name: 'PULSO', color: 0x94a3b8 }
    }
    if (bpm < 115) {
      return { name: 'CALENTAMIENTO', color: 0x38bdf8 } // Celeste
    }
    if (bpm < 130) {
      return { name: 'QUEMA GRASA', color: 0x06b6d4 } // Cyan
    }
    if (bpm < 150) {
      return { name: 'AERÓBICO', color: 0x22c55e } // Verde
    }
    if (bpm < 165) {
      return { name: 'ANAERÓBICO', color: 0xf59e0b } // Ámbar / Naranja
    }
    return { name: 'VO2 MÁX', color: 0xef4444 } // Rojo intenso
  },

  getHeartRateColor(bpm) {
    return this.getHeartRateZone(bpm).color
  },

  cycleBottomCard() {
    this.state.bottomCardMode = ((this.state.bottomCardMode || 0) + 1) % 4
    this.vibrate('short')
    this.updateUI()
  },

  getBottomCardStats() {
    const data = this.state.timerData
    const mode = this.state.bottomCardMode || 0
    const currentState = this.state.stateMachine ? this.state.stateMachine.getState() : STATES.READY

    // ==========================================
    // MODO ESPECIAL: RESUMEN AL FINALIZAR
    // ==========================================
    if (currentState === STATES.FINISHED) {
      const stats = this.state.timer ? this.state.timer.getStats() : {}
      const strokes = this.state.totalStrokes || 0
      const strokesPerLap = stats.totalLaps > 0 ? Math.round(strokes / stats.totalLaps) : 0
      const rec = this.state.lastRecoveryBpm || 0

      if (mode === 0) {
        return {
          metric1: `Total: ${stats.totalMeters}m • ${stats.totalTime}`,
          metric2: `Ritmo: ${stats.avgPace} /100m • ${stats.calories} kcal  [1/4]`
        }
      } else if (mode === 1) {
        return {
          metric1: `SWOLF: ${stats.avgSwolf} (Mejor: ${stats.bestSwolf})`,
          metric2: `Brazadas: ${strokes} (${strokesPerLap}/vta)  [2/4]`
        }
      } else if (mode === 2) {
        const peak = this.state.peakHeartRate > 0 ? `${this.state.peakHeartRate} bpm` : '--'
        return {
          metric1: `Pulso Max: ${peak}`,
          metric2: `Recuperacion: -${rec > 0 ? rec : 0} bpm en pared  [3/4]`
        }
      } else {
        return {
          metric1: `${stats.totalLaps} vueltas • Mejor: ${stats.bestLap}`,
          metric2: `Descanso total: ${stats.totalRestTime}  [4/4]`
        }
      }
    }

    if (mode === 0) {
      // MODO 0: SESIÓN GENERAL (acumulado total)
      return {
        metric1: `Tiempo total: ${data.formattedTotal}`,
        metric2: `Sesion: ${data.totalMeters}m acumulados  [1/4]`
      }
    } else if (mode === 1) {
      // MODO 1: SWOLF & EFICIENCIA DE BRAZADA
      const lastSwolf = data.lastLap && data.lastLap.swolf ? data.lastLap.swolf : '--'
      const avgSwolf = data.avgSwolf || '--'
      const strokes = this.state.totalStrokes || 0
      const strokesPerLap = data.totalLaps > 0 ? Math.round(strokes / data.totalLaps) : (this.state.strokesThisLap || 0)
      return {
        metric1: `SWOLF: ${lastSwolf}  •  Medio: ${avgSwolf}`,
        metric2: `Brazadas: ${strokes} (${strokesPerLap}/vta)  [2/4]`
      }
    } else if (mode === 2) {
      // MODO 2: FRECUENCIA CARDÍACA & RECUPERACIÓN EN PARED
      const hr = this.state.heartRate > 0 ? `${this.state.heartRate} bpm` : '--'
      if (currentState === STATES.PAUSED) {
        const peak = this.state.restStartHeartRate || this.state.heartRate || 0
        const current = this.state.heartRate || 0
        const drop = (peak > 0 && current > 0) ? (peak - current) : 0
        return {
          metric1: `Pulso en pared: ${hr}`,
          metric2: `Recuperacion: -${drop > 0 ? drop : 0} bpm  [3/4]`
        }
      } else {
        const peakText = this.state.peakHeartRate > 0 ? `Pico: ${this.state.peakHeartRate} bpm` : 'En movimiento'
        return {
          metric1: `Pulso actual: ${hr}`,
          metric2: `${peakText}  [3/4]`
        }
      }
    } else {
      // MODO 3: PARCIAL DEL ÚLTIMO SET
      if (data.lastInterval && data.lastInterval.meters > 0) {
        return {
          metric1: `Set ${data.lastInterval.intervalNumber}: ${data.lastInterval.meters}m en ${data.lastInterval.formattedTime}`,
          metric2: `Ritmo: ${data.lastInterval.pace100m} /100m  [4/4]`
        }
      } else if (data.lastLap) {
        return {
          metric1: `Vta ${data.lastLap.lapNumber}: ${data.lastLap.distanceMeters}m en ${data.lastLap.formattedLap}`,
          metric2: `Ritmo: ${data.lastLap.pace100m} /100m  [4/4]`
        }
      } else {
        return {
          metric1: `Set 1 en curso (${data.poolLength}m)`,
          metric2: `Esperando primer parcial  [4/4]`
        }
      }
    }
  },

  getHeartRateValue() {
    const s = this.state.heartSensor
    if (!s) return this.state.heartRate || 0

    let bpm = 0
    // Try methods getCurrent() / getLast()
    if (typeof s.getCurrent === 'function') {
      try { bpm = s.getCurrent() } catch (e) {}
    }
    if (!bpm && typeof s.getLast === 'function') {
      try { bpm = s.getLast() } catch (e) {}
    }
    // Try properties current / lastValue
    if (!bpm && typeof s.current !== 'undefined' && s.current > 0) {
      bpm = s.current
    }
    if (!bpm && typeof s.lastValue !== 'undefined' && s.lastValue > 0) {
      bpm = s.lastValue
    }
    // Try today historical array if current spot check is still 0
    if (!bpm) {
      try {
        const arr = typeof s.getToday === 'function' ? s.getToday() : s.today
        if (Array.isArray(arr) && arr.length > 0) {
          for (let i = arr.length - 1; i >= 0; i--) {
            const item = arr[i]
            const val = typeof item === 'number' ? item : (item && item.hr ? item.hr : 0)
            if (val > 30 && val < 240) {
              bpm = val
              break
            }
          }
        }
      } catch (e) {}
    }

    if (bpm > 30 && bpm < 240) {
      return bpm
    }
    return this.state.heartRate || 0
  },

  initHeartRate() {
    try {
      if (typeof hmSensor !== 'undefined' && typeof hmSensor.createSensor === 'function') {
        this.state.heartSensor = hmSensor.createSensor(hmSensor.id.HEART)
        if (this.state.heartSensor) {
          // If start method exists, call it
          if (typeof this.state.heartSensor.start === 'function') {
            try { this.state.heartSensor.start() } catch (e) {}
          }

          this.state.heartRate = this.getHeartRateValue()

          const onHeartChange = () => {
            const bpm = this.getHeartRateValue()
            if (bpm > 0) {
              this.state.heartRate = bpm
              if (bpm > (this.state.peakHeartRate || 0)) {
                this.state.peakHeartRate = bpm
              }
            }
            const zone = this.getHeartRateZone(this.state.heartRate)
            if (this.state.widgets.s0_heart) {
              const bpmText = this.state.heartRate > 0 ? `♥ ${this.state.heartRate} bpm` : '♥ -- bpm'
              this.state.widgets.s0_heart.setProperty(hmUI.prop.TEXT, bpmText)
              this.state.widgets.s0_heart.setProperty(hmUI.prop.COLOR, zone.color)
            }
            if (this.state.widgets.s0_heartLabel) {
              this.state.widgets.s0_heartLabel.setProperty(hmUI.prop.TEXT, zone.name)
              this.state.widgets.s0_heartLabel.setProperty(hmUI.prop.COLOR, zone.color)
            }
          }

          if (typeof this.state.heartSensor.onCurrentChange === 'function') {
            try { this.state.heartSensor.onCurrentChange(onHeartChange) } catch (e) {}
          }
          if (typeof this.state.heartSensor.addEventListener === 'function') {
            this.state.heartSensor.addEventListener(hmSensor.event.CHANGE, onHeartChange)
            if (typeof hmSensor.event.LAST_CHANGE !== 'undefined') {
              this.state.heartSensor.addEventListener(hmSensor.event.LAST_CHANGE, onHeartChange)
            }
          }
        }
      }
    } catch (e) {
      console.log('Heart Rate Sensor Init Error:', e)
    }
  },

  initAccelerometer() {
    try {
      if (typeof hmSensor !== 'undefined' && typeof hmSensor.createSensor === 'function') {
        this.state.accelSensor = hmSensor.createSensor(hmSensor.id.ACCELEROMETER)
        if (this.state.accelSensor) {
          if (typeof this.state.accelSensor.start === 'function') {
            this.state.accelSensor.start()
          }
          this.state.accelSensor.addEventListener(hmSensor.event.CHANGE, () => {
            this.handleAccelerometerData()
          })
        }
      }
    } catch (e) {
      console.log('Accelerometer Init Error:', e)
    }
  },

  processStrokeDetection(x, y, z, mag, now) {
    // Detect arm stroke cycles (wave in Z axis)
    const deltaZ = Math.abs(z - (this.state.lastAccelZ || 0))
    this.state.lastAccelZ = z

    // Stroke phase change threshold (> 220 mg variation with period > 550ms)
    if (deltaZ > 220 && (now - (this.state.lastStrokeTime || 0) > 550)) {
      this.state.strokesThisLap = (this.state.strokesThisLap || 0) + 1
      this.state.totalStrokes = (this.state.totalStrokes || 0) + 1
      this.state.lastStrokeTime = now
      console.log(`[STROKE] Brazada detectada! Vuelta: ${this.state.strokesThisLap} | Total: ${this.state.totalStrokes}`)
    }
  },

  handleAccelerometerData() {
    const currentState = this.state.stateMachine ? this.state.stateMachine.getState() : STATES.READY
    // Laps can ONLY be detected automatically while actively swimming!
    if (currentState !== STATES.RUNNING) return

    const accel = this.state.accelSensor
    if (!accel) return

    const x = accel.x || 0
    const y = accel.y || 0
    const z = accel.z || 0

    const mag = Math.sqrt(x * x + y * y + z * z)
    const now = Date.now()

    // Phase 1: Track continuous swimming strokes
    this.processStrokeDetection(x, y, z, mag, now)

    // Phase 2: Garmin-style verification rules:
    // A. Minimum time lock: at least 14 seconds of swimming for this lap (calibrated to user's 39s PB for 50m = ~19.5s per 25m)
    if (this.state.timerData.lapSeconds < 14) return

    // B. Minimum strokes verification: at least 4 real swimming strokes completed
    if ((this.state.strokesThisLap || 0) < 4) return

    // C. Wall push-off surge threshold (> 1.30G)
    const isMilliG = mag > 200
    const pushOffThreshold = isMilliG ? 1300 : 12.8

    // D. Temporal cooldown between consecutive turns (> 10 seconds)
    if (mag >= pushOffThreshold && (now - this.state.lastAutoLapTime > 10000)) {
      logDevice(`[AUTO LAP] Garmin Turn Confirmed! mag=${mag.toFixed(0)}, strokes=${this.state.strokesThisLap}`)
      this.state.lastAutoLapTime = now
      this.triggerLapDetected('auto')
    }
  },

  triggerLapDetected(source = 'auto') {
    const strokes = this.state.strokesThisLap || 0
    this.state.strokesThisLap = 0 // Reset stroke counter for the new lap
    const newLap = this.state.timer.splitLap(strokes)
    this.vibrate('short') // Wrist buzz confirms lap under water
    this.updateUI()
    console.log(`Lap ${newLap.lapNumber} complete (${source}, ${strokes} strokes, SWOLF ${newLap.swolf}). Distance: ${this.state.timerData.totalMeters}m`)
  },

  initStateMachine() {
    this.state.stateMachine = new WorkoutStateMachine((newState, oldState) => {
      console.log(`State transition: ${oldState} -> ${newState}`)
      this.handleStateChange(newState, oldState)
    })
  },

  initTimer() {
    this.state.timer = new WorkoutTimer((data) => {
      this.state.timerData = data
      this.renderTimerTick()
    })
  },

  handleStateChange(newState, oldState) {
    if (newState === STATES.RUNNING) {
      if (oldState === STATES.PAUSED) {
        this.state.timer.resume()
        this.vibrate('double')
      } else {
        this.state.timer.start()
        this.vibrate('short')
      }
      this.switchScreen(0) // Return to main timer screen
    } else if (newState === STATES.PAUSED) {
      this.state.restStartHeartRate = this.state.heartRate || 0
      const strokes = this.state.strokesThisLap || 0
      this.state.strokesThisLap = 0
      this.state.timer.pause(strokes)
      this.vibrate('double')
      this.switchScreen(0)
    } else if (newState === STATES.FINISHED) {
      const strokes = this.state.strokesThisLap || 0
      this.state.strokesThisLap = 0
      this.state.timer.finish(strokes)
      this.vibrate('long')
      this.switchScreen(0)
      this.uploadWorkoutToIntervals()
    } else if (newState === STATES.READY) {
      clearWorkoutFromDisk()
      const app = typeof getApp === 'function' ? getApp() : null
      if (app && app.globalData) app.globalData.activeWorkout = null
      this.state.totalStrokes = 0
      this.state.peakHeartRate = 0
      this.state.lastRecoveryBpm = 0
      this.state.timer.reset()
      this.vibrate('short')
      this.switchScreen(0)
    }
    this.persistWorkoutState()
    this.updateUI()
  },

  createUI() {
    // Pitch Black Background
    hmUI.createWidget(hmUI.widget.FILL_RECT, {
      x: 0,
      y: 0,
      w: 480,
      h: 480,
      color: 0x000000
    })

    // Clock at the top (Y: 12) - enlarged & high-contrast for pool visibility
    this.state.widgets.s0_clock = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 130,
      y: 12,
      w: 220,
      h: 28,
      color: 0xffffff,
      text_size: 26,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: this.getCurrentTimeText()
    })

    // Page Indicator Dots (Y: 42)
    this.state.widgets.pageDots = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 140,
      y: 42,
      w: 200,
      h: 16,
      color: 0x475569,
      text_size: 13,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: '●  ○  ○'
    })

    // ==========================================
    // SCREEN 0: CRONÓMETRO PRINCIPAL DE NADO (Garmin Style)
    // ==========================================
    // Status Badge Pill (Y: 68)
    this.state.widgets.s0_badgeBg = hmUI.createWidget(hmUI.widget.FILL_RECT, {
      x: 165,
      y: 68,
      w: 150,
      h: 28,
      color: 0x0284c7,
      radius: 14
    })

    this.state.widgets.s0_badgeText = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 165,
      y: 68,
      w: 150,
      h: 28,
      color: 0xffffff,
      text_size: 17,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'LISTO'
    })

    // SubHeader: Active Set / Interval (Y: 100)
    this.state.widgets.s0_subHeader = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 30,
      y: 100,
      w: 420,
      h: 24,
      color: 0x38bdf8,
      text_size: 20,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'PILETA: 25m'
    })

    // Big Main Timer: Hero Field (Y: 132)
    this.state.widgets.s0_timer = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 10,
      y: 132,
      w: 460,
      h: 78,
      color: 0xffffff,
      text_size: 78,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: '00:00'
    })

    // Timer Label / Interval Summary Line (Y: 214)
    this.state.widgets.s0_timerLabel = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 30,
      y: 214,
      w: 420,
      h: 24,
      color: 0x94a3b8,
      text_size: 18,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'LISTO PARA SALIR'
    })

    // Two Primary Metric Columns: Heart Rate (Left) & Distance (Right) (Y: 242)
    this.state.widgets.s0_heart = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 45,
      y: 242,
      w: 190,
      h: 34,
      color: 0xf43f5e,
      text_size: 26,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: '♥ -- bpm'
    })

    this.state.widgets.s0_heartLabel = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 45,
      y: 276,
      w: 190,
      h: 20,
      color: 0x64748b,
      text_size: 14,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'PULSO'
    })

    this.state.widgets.s0_distance = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 245,
      y: 242,
      w: 190,
      h: 34,
      color: 0x38bdf8,
      text_size: 26,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: '0m'
    })

    this.state.widgets.s0_distanceLabel = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 245,
      y: 276,
      w: 190,
      h: 20,
      color: 0x64748b,
      text_size: 14,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'TOTAL'
    })

    // Sleek Session Stats Card (Y: 302 to 386) - enlarged font for goggles
    this.state.widgets.s0_cardBg = hmUI.createWidget(hmUI.widget.FILL_RECT, {
      x: 65,
      y: 302,
      w: 350,
      h: 84,
      color: 0x0f172a,
      radius: 18
    })

    this.state.widgets.s0_metric1 = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 70,
      y: 308,
      w: 340,
      h: 36,
      color: 0x38bdf8,
      text_size: 22,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'Tiempo total: 00:00'
    })

    this.state.widgets.s0_metric2 = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 70,
      y: 344,
      w: 340,
      h: 34,
      color: 0xe2e8f0,
      text_size: 19,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'Sesión: 0m acumulados  [1/4]'
    })

    // ==========================================
    // SCREEN 1: TABLA DE PARCIALES (LAPS)
    // ==========================================
    this.state.widgets.s1_title = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 30,
      y: 64,
      w: 420,
      h: 30,
      color: 0x38bdf8,
      text_size: 22,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'PARCIALES DE NADO'
    })

    this.state.widgets.s1_row1 = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 40,
      y: 104,
      w: 400,
      h: 56,
      color: 0xffffff,
      text_size: 20,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'Sin vueltas registradas aún'
    })

    this.state.widgets.s1_row2 = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 40,
      y: 168,
      w: 400,
      h: 56,
      color: 0xe2e8f0,
      text_size: 20,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: ''
    })

    this.state.widgets.s1_row3 = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 40,
      y: 232,
      w: 400,
      h: 56,
      color: 0xcbd5e1,
      text_size: 20,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: ''
    })

    this.state.widgets.s1_row4 = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 40,
      y: 296,
      w: 400,
      h: 56,
      color: 0x94a3b8,
      text_size: 20,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: ''
    })

    // ==========================================
    // SCREEN 2: AJUSTES & SESIÓN
    // ==========================================
    this.state.widgets.s2_title = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 30,
      y: 64,
      w: 420,
      h: 30,
      color: 0x38bdf8,
      text_size: 22,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'AJUSTES & SESIÓN'
    })

    // Pool setting card
    this.state.widgets.s2_poolCard = hmUI.createWidget(hmUI.widget.FILL_RECT, {
      x: 50,
      y: 104,
      w: 380,
      h: 68,
      color: 0x0f172a,
      radius: 14
    })

    this.state.widgets.s2_poolText1 = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 60,
      y: 110,
      w: 360,
      h: 28,
      color: 0x38bdf8,
      text_size: 20,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'Pileta: 25 Metros'
    })

    this.state.widgets.s2_poolText2 = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 60,
      y: 138,
      w: 360,
      h: 24,
      color: 0x94a3b8,
      text_size: 15,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: '25m  •  33m  •  50m'
    })

    // Stats card
    this.state.widgets.s2_statsCard = hmUI.createWidget(hmUI.widget.FILL_RECT, {
      x: 50,
      y: 182,
      w: 380,
      h: 90,
      color: 0x0f172a,
      radius: 14
    })

    this.state.widgets.s2_statsText1 = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 60,
      y: 188,
      w: 360,
      h: 26,
      color: 0xffffff,
      text_size: 18,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'Nado: 00:00  •  Descanso: 00:00'
    })

    this.state.widgets.s2_statsText2 = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 60,
      y: 214,
      w: 360,
      h: 26,
      color: 0x00e5ff,
      text_size: 18,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'Metros: 0m  •  Ritmo: --:--'
    })

    this.state.widgets.s2_statsText3 = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 60,
      y: 240,
      w: 360,
      h: 24,
      color: 0xfbbf24,
      text_size: 16,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'Calorías estimadas: 0 kcal'
    })

    // Red Exit Button Card
    this.state.widgets.s2_exitBg = hmUI.createWidget(hmUI.widget.FILL_RECT, {
      x: 60,
      y: 284,
      w: 360,
      h: 54,
      color: 0xdc2626,
      radius: 20
    })

    this.state.widgets.s2_exitText = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 60,
      y: 284,
      w: 360,
      h: 54,
      color: 0xffffff,
      text_size: 20,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'SALIR AL RELOJ'
    })

    // Controls & Info Card (Y: 346, H: 98)
    this.state.widgets.s2_infoCard = hmUI.createWidget(hmUI.widget.FILL_RECT, {
      x: 50,
      y: 346,
      w: 380,
      h: 96,
      color: 0x0f172a,
      radius: 14
    })

    this.state.widgets.s2_infoTitle = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 60,
      y: 350,
      w: 360,
      h: 20,
      color: 0x38bdf8,
      text_size: 14,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'CONTROLES FÍSICOS (SIN TÁCTIL)'
    })

    this.state.widgets.s2_infoLine1 = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 60,
      y: 372,
      w: 360,
      h: 20,
      color: 0x94a3b8,
      text_size: 14,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'Corona: Cambiar pantallas (1, 2 y 3)'
    })

    this.state.widgets.s2_infoLine2 = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 60,
      y: 394,
      w: 360,
      h: 20,
      color: 0x94a3b8,
      text_size: 14,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'Boton Abajo: Cambiar largo de pileta'
    })

    this.state.widgets.s2_infoLine3 = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 60,
      y: 416,
      w: 360,
      h: 20,
      color: 0x22c55e,
      text_size: 14,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'Boton Arriba: Salir al reloj'
    })
  },

  switchScreen(screenIndex) {
    this.state.currentScreen = screenIndex
    const isS0 = screenIndex === 0
    const isS1 = screenIndex === 1
    const isS2 = screenIndex === 2

    // Update Page Dots
    if (this.state.widgets.pageDots) {
      const dots = isS0 ? '●  ○  ○' : isS1 ? '○  ●  ○' : '○  ○  ●'
      this.state.widgets.pageDots.setProperty(hmUI.prop.TEXT, dots)
    }

    // Toggle S0 Widgets
    const s0Widgets = [
      's0_clock', 's0_heart', 's0_heartLabel', 's0_badgeBg', 's0_badgeText',
      's0_distance', 's0_distanceLabel', 's0_subHeader', 's0_timer', 's0_timerLabel',
      's0_cardBg', 's0_metric1', 's0_metric2'
    ]
    s0Widgets.forEach((w) => {
      if (this.state.widgets[w]) this.state.widgets[w].setProperty(hmUI.prop.VISIBLE, isS0)
    })

    // Toggle S1 Widgets
    const s1Widgets = [
      's1_title', 's1_row1', 's1_row2', 's1_row3', 's1_row4'
    ]
    s1Widgets.forEach((w) => {
      if (this.state.widgets[w]) this.state.widgets[w].setProperty(hmUI.prop.VISIBLE, isS1)
    })

    // Toggle S2 Widgets
    const s2Widgets = [
      's2_title', 's2_poolCard', 's2_poolText1', 's2_poolText2',
      's2_statsCard', 's2_statsText1', 's2_statsText2', 's2_statsText3',
      's2_exitBg', 's2_exitText',
      's2_infoCard', 's2_infoTitle', 's2_infoLine1', 's2_infoLine2', 's2_infoLine3'
    ]
    s2Widgets.forEach((w) => {
      if (this.state.widgets[w]) this.state.widgets[w].setProperty(hmUI.prop.VISIBLE, isS2)
    })

    if (isS1) {
      this.renderLapsScreen()
    } else if (isS2) {
      this.renderSettingsScreen()
    } else {
      this.updateUI()
    }
  },

  renderTimerTick() {
    if (this.state.timerData && this.state.timerData.totalSeconds % 5 === 0) {
      this.keepScreenAwake()
    }
    if (this.state.currentScreen !== 0) return
    const currentState = this.state.stateMachine ? this.state.stateMachine.getState() : STATES.READY
    const data = this.state.timerData

    // Live Heart Rate refresh on every second tick
    const bpm = this.getHeartRateValue()
    if (bpm > 0) {
      this.state.heartRate = bpm
      if (bpm > (this.state.peakHeartRate || 0)) {
        this.state.peakHeartRate = bpm
      }
      if (currentState === STATES.PAUSED || currentState === STATES.FINISHED) {
        const peak = this.state.restStartHeartRate || this.state.peakHeartRate || 0
        const drop = (peak > 0 && bpm > 0) ? (peak - bpm) : 0
        if (drop > (this.state.lastRecoveryBpm || 0)) {
          this.state.lastRecoveryBpm = drop
        }
      }
    }
    const hrZone = this.getHeartRateZone(this.state.heartRate)
    if (this.state.widgets.s0_heart) {
      const bpmText = this.state.heartRate > 0 ? `♥ ${this.state.heartRate} bpm` : '♥ -- bpm'
      this.state.widgets.s0_heart.setProperty(hmUI.prop.TEXT, bpmText)
      this.state.widgets.s0_heart.setProperty(hmUI.prop.COLOR, hrZone.color)
    }
    if (this.state.widgets.s0_heartLabel) {
      this.state.widgets.s0_heartLabel.setProperty(hmUI.prop.TEXT, hrZone.name)
      this.state.widgets.s0_heartLabel.setProperty(hmUI.prop.COLOR, hrZone.color)
    }

    // Live Clock refresh
    if (this.state.widgets.s0_clock) {
      this.state.widgets.s0_clock.setProperty(hmUI.prop.TEXT, this.getCurrentTimeText())
    }

    // Persist to flash storage periodically while workout is active (every 3s)
    const activeSecs = currentState === STATES.PAUSED ? (data.restSeconds || 0) : (data.totalSeconds || 0)
    if (activeSecs % 3 === 0 && currentState !== STATES.READY) {
      this.persistWorkoutState()
    }

    // Keep screen lease active (renew bright time every 60s)
    if (activeSecs % 60 === 0 && currentState !== STATES.READY) {
      this.keepScreenAwake()
    }

    // Periodic heartbeat log every 10s to Zepp app device logs
    if (data.totalSeconds % 10 === 0 && data.totalSeconds > 0 && currentState !== STATES.READY) {
      const t = this.state.telemetry || {}
      logDevice(`[HEARTBEAT ${data.formattedTotal}] Offs: ${t.screenOffCount || 0} | Wakes: ${t.restoreCount || 0} | Dormido: ${t.totalSleepSeconds || 0}s | HR: ${this.state.heartRate || 0}`)
    }

    if (currentState === STATES.RUNNING) {
      if (this.state.widgets.s0_timer) {
        this.state.widgets.s0_timer.setProperty(hmUI.prop.TEXT, data.formattedInterval || data.formattedLap)
        this.state.widgets.s0_timer.setProperty(hmUI.prop.COLOR, 0xffffff)
      }
      if (this.state.widgets.s0_timerLabel) {
        const pace = data.intervalPace !== '--:--' ? data.intervalPace : data.avgPace100m
        this.state.widgets.s0_timerLabel.setProperty(hmUI.prop.TEXT, `Ritmo: ${pace} /100m`)
      }
      if (this.state.widgets.s0_distance) {
        const dist = data.intervalMeters || 0
        this.state.widgets.s0_distance.setProperty(hmUI.prop.TEXT, `${dist}m`)
      }
    } else if (currentState === STATES.PAUSED) {
      if (this.state.widgets.s0_timer) {
        this.state.widgets.s0_timer.setProperty(hmUI.prop.TEXT, data.formattedRest)
        this.state.widgets.s0_timer.setProperty(hmUI.prop.COLOR, 0xfbbf24) // Gold
      }
      if (this.state.widgets.s0_timerLabel) {
        const lastTxt = (data.lastInterval && data.lastInterval.meters > 0)
          ? `Último: ${data.lastInterval.meters}m en ${data.lastInterval.formattedTime} • Total: ${data.totalMeters || 0}m`
          : `Descanso • Total: ${data.totalMeters || 0}m`
        this.state.widgets.s0_timerLabel.setProperty(hmUI.prop.TEXT, lastTxt)
      }
      if (this.state.widgets.s0_distance) {
        this.state.widgets.s0_distance.setProperty(hmUI.prop.TEXT, `${data.totalMeters || 0}m`)
      }
    }

    // Refresh bottom card live
    const cardStats = this.getBottomCardStats()
    if (this.state.widgets.s0_metric1) {
      this.state.widgets.s0_metric1.setProperty(hmUI.prop.TEXT, cardStats.metric1)
    }
    if (this.state.widgets.s0_metric2) {
      this.state.widgets.s0_metric2.setProperty(hmUI.prop.TEXT, cardStats.metric2)
    }
  },

  renderLapsScreen() {
    const laps = this.state.timer ? this.state.timer.getLaps() : []
    const rows = ['s1_row1', 's1_row2', 's1_row3', 's1_row4']

    if (laps.length === 0) {
      if (this.state.widgets.s1_row1) {
        this.state.widgets.s1_row1.setProperty(hmUI.prop.TEXT, 'Sin vueltas registradas aún')
      }
      for (let i = 1; i < rows.length; i++) {
        if (this.state.widgets[rows[i]]) this.state.widgets[rows[i]].setProperty(hmUI.prop.TEXT, '')
      }
      return
    }

    // Display last 4 completed laps in reverse order (newest first)
    const reversed = [...laps].reverse()
    for (let i = 0; i < rows.length; i++) {
      const lap = reversed[i]
      if (lap && this.state.widgets[rows[i]]) {
        this.state.widgets[rows[i]].setProperty(
          hmUI.prop.TEXT,
          `Vta ${lap.lapNumber} (${lap.distanceMeters}m): ${lap.formattedLap} • ${lap.pace100m}/100m\nDescanso: ${lap.formattedRest}`
        )
      } else if (this.state.widgets[rows[i]]) {
        this.state.widgets[rows[i]].setProperty(hmUI.prop.TEXT, '')
      }
    }
  },

  renderSettingsScreen() {
    const data = this.state.timerData
    const stats = this.state.timer ? this.state.timer.getStats() : {}

    if (this.state.widgets.s2_poolText1) {
      this.state.widgets.s2_poolText1.setProperty(
        hmUI.prop.TEXT,
        `Pileta: ${data.poolLength} Metros`
      )
    }
    if (this.state.widgets.s2_poolText2) {
      this.state.widgets.s2_poolText2.setProperty(
        hmUI.prop.TEXT,
        'Largo: 25m • 33m • 50m'
      )
    }
    if (this.state.widgets.s2_statsText1) {
      this.state.widgets.s2_statsText1.setProperty(
        hmUI.prop.TEXT,
        `Nado: ${data.formattedTotal} • Descanso: ${data.formattedTotalRest}`
      )
    }
    if (this.state.widgets.s2_statsText2) {
      this.state.widgets.s2_statsText2.setProperty(
        hmUI.prop.TEXT,
        `Metros: ${data.totalMeters}m • Ritmo: ${data.avgPace100m}`
      )
    }
    if (this.state.widgets.s2_statsText3) {
      const hrText = this.state.heartRate > 0 ? `${this.state.heartRate} bpm` : '--'
      const swolfTxt = stats.avgSwolf !== '--' ? `SWOLF: ${stats.avgSwolf} • ` : ''
      this.state.widgets.s2_statsText3.setProperty(
        hmUI.prop.TEXT,
        `${swolfTxt}Pulso: ${hrText} • ${stats.calories || 0} kcal`
      )
    }

    if (this.state.widgets.s2_exitText) {
      const curState = this.state.stateMachine ? this.state.stateMachine.getState() : STATES.READY
      const isWorkoutActive = curState === STATES.RUNNING || curState === STATES.PAUSED
      if (isWorkoutActive) {
        this.state.widgets.s2_exitText.setProperty(hmUI.prop.TEXT, 'FINALIZAR SESIÓN')
        if (this.state.widgets.s2_exitBg) this.state.widgets.s2_exitBg.setProperty(hmUI.prop.COLOR, 0xdc2626) // Red
      } else if (curState === STATES.FINISHED) {
        if (this.state.uploadStatus === 'uploading') {
          this.state.widgets.s2_exitText.setProperty(hmUI.prop.TEXT, 'SUBIENDO A INTERVALS...')
          if (this.state.widgets.s2_exitBg) this.state.widgets.s2_exitBg.setProperty(hmUI.prop.COLOR, 0xd97706) // Amber
        } else if (this.state.uploadStatus === 'success') {
          this.state.widgets.s2_exitText.setProperty(hmUI.prop.TEXT, '✓ INTERVALS • SALIR')
          if (this.state.widgets.s2_exitBg) this.state.widgets.s2_exitBg.setProperty(hmUI.prop.COLOR, 0x16a34a) // Green
        } else if (this.state.uploadStatus === 'error') {
          this.state.widgets.s2_exitText.setProperty(hmUI.prop.TEXT, 'REINTENTAR SUBIDA')
          if (this.state.widgets.s2_exitBg) this.state.widgets.s2_exitBg.setProperty(hmUI.prop.COLOR, 0xd97706) // Amber
        } else {
          this.state.widgets.s2_exitText.setProperty(hmUI.prop.TEXT, 'SALIR AL RELOJ')
          if (this.state.widgets.s2_exitBg) this.state.widgets.s2_exitBg.setProperty(hmUI.prop.COLOR, 0xdc2626)
        }
      } else {
        this.state.widgets.s2_exitText.setProperty(hmUI.prop.TEXT, 'SALIR AL RELOJ')
        if (this.state.widgets.s2_exitBg) this.state.widgets.s2_exitBg.setProperty(hmUI.prop.COLOR, 0xdc2626)
      }
    }

    if (this.state.widgets.s2_infoLine2) {
      const curState = this.state.stateMachine ? this.state.stateMachine.getState() : STATES.READY
      if (curState === STATES.FINISHED) {
        this.state.widgets.s2_infoLine2.setProperty(hmUI.prop.TEXT, 'Boton Abajo: Reintentar Intervals')
        this.state.widgets.s2_infoLine2.setProperty(hmUI.prop.COLOR, 0x38bdf8)
      } else {
        this.state.widgets.s2_infoLine2.setProperty(hmUI.prop.TEXT, 'Boton Abajo: Cambiar largo de pileta')
        this.state.widgets.s2_infoLine2.setProperty(hmUI.prop.COLOR, 0x94a3b8)
      }
    }


  },

  updateUI() {
    if (this.state.currentScreen !== 0) return
    const currentState = this.state.stateMachine ? this.state.stateMachine.getState() : STATES.READY
    const data = this.state.timerData

    if (this.state.widgets.s0_clock) {
      this.state.widgets.s0_clock.setProperty(hmUI.prop.TEXT, this.getCurrentTimeText())
    }

    const cardStats = this.getBottomCardStats()
    let metric1 = cardStats.metric1
    let metric2 = cardStats.metric2

    let badgeColor = 0x0284c7
    let badgeText = 'LISTO'
    let subHeader = `PILETA: ${data.poolLength}m`
    let timerLabel = 'LISTO PARA SALIR'
    let timerText = '00:00'
    let timerColor = 0x38bdf8
    let distanceText = '0m'
    let distanceLabel = 'TOTAL'

    switch (currentState) {
      case STATES.READY:
        badgeColor = 0x0284c7
        badgeText = 'LISTO'
        subHeader = `PILETA: ${data.poolLength}m`
        timerLabel = 'LISTO PARA SALIR'
        timerText = '00:00'
        timerColor = 0x38bdf8
        distanceText = '0m'
        distanceLabel = 'TOTAL'
        break

      case STATES.RUNNING:
        badgeColor = 0x16a34a
        badgeText = `SET ${data.currentIntervalNumber || 1}`
        subHeader = `VUELTA ${data.currentLapNumber}`
        timerLabel = `Ritmo: ${data.intervalPace !== '--:--' ? data.intervalPace : data.avgPace100m} /100m`
        timerText = data.formattedInterval || data.formattedLap
        timerColor = 0xffffff
        distanceText = `${data.intervalMeters || 0}m`
        distanceLabel = 'ESTE SET'
        break

      case STATES.PAUSED:
        badgeColor = 0xd97706
        badgeText = 'DESCANSO'
        subHeader = (data.lastInterval && data.lastInterval.meters > 0)
          ? `SET ${data.lastInterval.intervalNumber} COMPLETADO`
          : 'PAUSA EN PARED'
        timerLabel = (data.lastInterval && data.lastInterval.meters > 0)
          ? `Último: ${data.lastInterval.meters}m en ${data.lastInterval.formattedTime} (${data.lastInterval.pace100m})`
          : 'Descanso en pared'
        timerText = data.formattedRest
        timerColor = 0xfbbf24
        distanceText = `${data.totalMeters || 0}m`
        distanceLabel = 'TOTAL'
        break

      case STATES.FINISHED:
        const stats = this.state.timer.getStats()
        badgeColor = 0xdc2626
        badgeText = 'RESUMEN'
        subHeader = `FINALIZADO (${stats.totalMeters}m)`
        timerLabel = stats.avgSwolf !== '--' ? `SWOLF: ${stats.avgSwolf} • Ritmo: ${stats.avgPace}` : `Ritmo: ${stats.avgPace} /100m`
        timerText = stats.totalTime
        timerColor = 0x22d3ee
        distanceText = `${stats.totalMeters}m`
        distanceLabel = 'TOTAL'
        break

      default:
        break
    }

    if (this.state.widgets.s0_badgeBg) this.state.widgets.s0_badgeBg.setProperty(hmUI.prop.COLOR, badgeColor)
    if (this.state.widgets.s0_badgeText) this.state.widgets.s0_badgeText.setProperty(hmUI.prop.TEXT, badgeText)
    if (this.state.widgets.s0_subHeader) this.state.widgets.s0_subHeader.setProperty(hmUI.prop.TEXT, subHeader)
    if (this.state.widgets.s0_timer) {
      this.state.widgets.s0_timer.setProperty(hmUI.prop.TEXT, timerText)
      this.state.widgets.s0_timer.setProperty(hmUI.prop.COLOR, timerColor)
    }
    if (this.state.widgets.s0_timerLabel) this.state.widgets.s0_timerLabel.setProperty(hmUI.prop.TEXT, timerLabel)
    if (this.state.widgets.s0_distance) this.state.widgets.s0_distance.setProperty(hmUI.prop.TEXT, distanceText)
    if (this.state.widgets.s0_distanceLabel) this.state.widgets.s0_distanceLabel.setProperty(hmUI.prop.TEXT, distanceLabel)
    if (this.state.widgets.s0_metric1) this.state.widgets.s0_metric1.setProperty(hmUI.prop.TEXT, metric1)
    if (this.state.widgets.s0_metric2) this.state.widgets.s0_metric2.setProperty(hmUI.prop.TEXT, metric2)
    const hrZone = this.getHeartRateZone(this.state.heartRate)
    if (this.state.widgets.s0_heart) {
      const bpmText = this.state.heartRate > 0 ? `♥ ${this.state.heartRate} bpm` : '♥ -- bpm'
      this.state.widgets.s0_heart.setProperty(hmUI.prop.TEXT, bpmText)
      this.state.widgets.s0_heart.setProperty(hmUI.prop.COLOR, hrZone.color)
    }
    if (this.state.widgets.s0_heartLabel) {
      this.state.widgets.s0_heartLabel.setProperty(hmUI.prop.TEXT, hrZone.name)
      this.state.widgets.s0_heartLabel.setProperty(hmUI.prop.COLOR, hrZone.color)
    }
  },

  handleCrownSpin(degree) {
    const now = Date.now()
    // Cooldown: prevent changing screens more than once every 280ms
    if (now - (this.state.lastCrownSwitchTime || 0) < 280) {
      return
    }

    // Accumulate degrees (GTR 3 Pro sends small degree increments per notch)
    this.state.crownAccumulator = (this.state.crownAccumulator || 0) + degree
    const THRESHOLD = 28 // Solid physical threshold for 1 deliberate click/twist

    if (this.state.crownAccumulator >= THRESHOLD) {
      this.state.crownAccumulator = 0
      this.state.lastCrownSwitchTime = now
      if (this.state.currentScreen < 2) {
        this.switchScreen(this.state.currentScreen + 1)
        logDevice('[CROWN] Cambio a pantalla ' + this.state.currentScreen)
        this.vibrate('short')
      }
    } else if (this.state.crownAccumulator <= -THRESHOLD) {
      this.state.crownAccumulator = 0
      this.state.lastCrownSwitchTime = now
      if (this.state.currentScreen > 0) {
        this.switchScreen(this.state.currentScreen - 1)
        logDevice('[CROWN] Cambio a pantalla ' + this.state.currentScreen)
        this.vibrate('short')
      }
    }
  },

  registerSpinListener() {
    console.log('Registering Digital Crown Spin Listener for GTR 3 Pro')
    if (typeof hmApp !== 'undefined' && typeof hmApp.registerSpinEvent === 'function') {
      hmApp.registerSpinEvent((key, degree) => {
        this.handleCrownSpin(degree)
      })
    } else {
      console.log('hmApp.registerSpinEvent not supported on this device/version')
    }
  },

  exitApp() {
    this.state.isExplicitExit = true
    console.log('Exiting Swimming App to Watchface')
    const curState = this.state.stateMachine ? this.state.stateMachine.getState() : STATES.READY
    if (curState === STATES.FINISHED || curState === STATES.READY) {
      clearWorkoutFromDisk()
      const app = typeof getApp === 'function' ? getApp() : null
      if (app && app.globalData) app.globalData.activeWorkout = null
    }
    this.vibrate('short')
    if (typeof hmSetting !== 'undefined') {
      try {
        if (typeof hmSetting.setBrightScreenCancel === 'function') hmSetting.setBrightScreenCancel()
        if (typeof hmSetting.releaseWristDownOff === 'function') hmSetting.releaseWristDownOff()
        if (typeof hmSetting.releasePalmOff === 'function') hmSetting.releasePalmOff()
      } catch (e) {}
    }
    if (typeof hmFS !== 'undefined') {
      try {
        if (typeof hmFS.SysProSetBool === 'function') {
          hmFS.SysProSetBool('settings_switch_screen_constant_bright_on_sport', false)
          if (this.state.savedDndSwitch !== undefined) {
            hmFS.SysProSetBool('settings_switch_dnd', this.state.savedDndSwitch)
          }
          if (this.state.savedScreenNotifyBright !== undefined) {
            hmFS.SysProSetBool('settings_switch_screen_nofity_bright', this.state.savedScreenNotifyBright)
          }
        }
        if (typeof hmFS.SysProSetInt === 'function') {
          const restoreDur = (this.state.savedScreenDuration !== undefined && this.state.savedScreenDuration > 0) ? this.state.savedScreenDuration : 15
          hmFS.SysProSetInt('settings_data_screen_duration', restoreDur)
        }
      } catch (e) {}
    }
    if (typeof hmApp !== 'undefined' && typeof hmApp.exit === 'function') {
      try {
        hmApp.exit()
      } catch (e) {
        console.log('hmApp.exit error:', e)
      }
    }
  },

  registerPhysicalKeys() {
    console.log('Registering Physical Key Listener for GTR 3 Pro')

    if (typeof hmApp === 'undefined' || typeof hmApp.registerKeyEvent !== 'function') {
      console.log('hmApp.registerKeyEvent not available')
      return
    }

    hmApp.registerKeyEvent((key, action) => {
      const now = Date.now()
      
      // Cooldown after returning from notifications or page wake:
      // Completely blocks the crown press that dismissed WhatsApp from triggering actions in Anduin!
      if (now < (this.state.ignoreKeysUntil || 0)) {
        console.log('Debouncing key press from notification dismissal')
        return true
      }

      // Check key identity
      const isTopButton =
        key === (typeof hmApp.key !== 'undefined' ? hmApp.key.SELECT : 2) ||
        key === (typeof hmApp.key !== 'undefined' ? hmApp.key.HOME : 3) ||
        key === 2 ||
        key === 3

      const isBottomButton =
        key === (typeof hmApp.key !== 'undefined' ? hmApp.key.SHORTCUT : 1) ||
        key === (typeof hmApp.key !== 'undefined' ? hmApp.key.BACK : 5) ||
        key === (typeof hmApp.key !== 'undefined' ? hmApp.key.DOWN : 1) ||
        key === 1 ||
        key === 5

      // Actions in Zepp OS:
      // 1: CLICK
      // 2: LONG_PRESS
      // 8: RELEASE / UP
      // 16: PRESS / DOWN
      const isLongPressAction =
        action === 2 ||
        (typeof hmApp.action !== 'undefined' && action === hmApp.action.LONG_PRESS)

      const isClickAction =
        action === 1 ||
        (typeof hmApp.action !== 'undefined' && action === hmApp.action.CLICK)

      const isKeyDownAction =
        action === 16 ||
        (typeof hmApp.action !== 'undefined' && action === hmApp.action.PRESS)

      const isKeyUpAction =
        action === 8 ||
        (typeof hmApp.action !== 'undefined' && action === hmApp.action.RELEASE)

      // Software hold timer: track when button was pushed down
      if (isKeyDownAction) {
        if (isTopButton) this.state.topKeyDownTime = now
        if (isBottomButton) this.state.bottomKeyDownTime = now
        return true
      }

      const topHoldDuration = isTopButton && this.state.topKeyDownTime ? (now - this.state.topKeyDownTime) : 0
      const bottomHoldDuration = isBottomButton && this.state.bottomKeyDownTime ? (now - this.state.bottomKeyDownTime) : 0

      // Long press is triggered if OS sent LONG_PRESS (2) OR if held for >= 700ms before release
      const isLongPress = isLongPressAction || topHoldDuration >= 700 || bottomHoldDuration >= 700
      const isPress = (isClickAction || isKeyUpAction) && !isLongPress

      if (!isPress && !isLongPress) {
        return true
      }

      // Reset down timestamps once handled
      if (isTopButton) this.state.topKeyDownTime = 0
      if (isBottomButton) this.state.bottomKeyDownTime = 0

      // DEBOUNCE FIX: Ignore repeat events within 250ms
      if (now - (this.state.lastKeyEventTime || 0) < 250) {
        console.log('Debouncing rapid key event')
        return true
      }
      this.state.lastKeyEventTime = now

      const currentState = this.state.stateMachine.getState()
      logDevice(`[KEY] key=${key}, action=${action}, isLong=${isLongPress}, state=${currentState}`)

      // ==========================================
      // 1. LONG PRESS SHORTCUTS
      // ==========================================
      // Long press bottom button in READY or FINISHED -> Exit app
      if (isLongPress && isBottomButton && (currentState === STATES.READY || currentState === STATES.FINISHED)) {
        this.exitApp()
        return true
      }

      // Long press top button in running/paused -> Finish workout
      if (isLongPress && isTopButton && (currentState === STATES.RUNNING || currentState === STATES.PAUSED)) {
        this.state.stateMachine.transition('FINISH')
        return true
      }

      // Long press top button in finished -> Reset for new workout
      if (isLongPress && isTopButton && currentState === STATES.FINISHED) {
        this.state.stateMachine.transition('RESET')
        return true
      }

      // ==========================================
      // 2. SCREEN 2 (AJUSTES & SALIR) CONTROLS
      // ==========================================
      if (this.state.currentScreen === 2) {
        if (isTopButton) {
          if (currentState === STATES.RUNNING || currentState === STATES.PAUSED) {
            // Crown on Screen 2 finalizes active workout and goes to RESUMEN!
            this.state.stateMachine.transition('FINISH')
            this.switchScreen(0)
            return true
          } else {
            // Crown in READY or FINISHED exits cleanly to watchface
            this.exitApp()
            return true
          }
        }
        if (isBottomButton) {
          if (currentState === STATES.FINISHED) {
            // Reintentar subida a Intervals.icu
            this.vibrate('short')
            this.uploadWorkoutToIntervals()
            return true
          }
          // Cambia largo de pileta (25m -> 33m -> 50m) tanto en clic simple como en pulsación larga!
          const newPool = this.state.timer.cyclePoolLength()
          this.vibrate('short')
          this.renderSettingsScreen()
          return true
        }
        return true
      }

      // ==========================================
      // 3. MAIN WORKOUT CONTROLS (SCREEN 0 & 1)
      // ==========================================
      if (currentState === STATES.READY) {
        // Top button: START
        if (isTopButton) {
          this.state.stateMachine.transition('START')
          return true
        }
        // Bottom button on Screen 0: Cycle bottom card stats!
        if (isBottomButton) {
          this.cycleBottomCard()
          return true
        }
      }

      if (currentState === STATES.RUNNING) {
        if (isTopButton) {
          // Top Button: PAUSE
          this.state.stateMachine.transition('PAUSE')
          return true
        }
        if (isBottomButton) {
          if (isLongPress) {
            // Swimmer Manual Lap: Mantener presionado el botón abajo registra una vuelta manual inmediatamente
            logDevice('[KEY] Manual Lap split activado por botón abajo sostenido!')
            this.vibrate('double')
            this.triggerLapDetected('manual')
            return true
          }
          // Clic normal: Cambia tarjeta inferior (SWOLF, Recuperación, Telemetría, etc.)
          this.cycleBottomCard()
          return true
        }
      }

      if (currentState === STATES.PAUSED) {
        if (isTopButton) {
          // Top Button: RESUME next set
          this.state.stateMachine.transition('RESUME')
          return true
        }
        if (isBottomButton) {
          // Bottom Button: Cycle bottom stats!
          this.cycleBottomCard()
          return true
        }
      }

      if (currentState === STATES.FINISHED) {
        if (isTopButton) {
          // Top button toggles between Resumen (Screen 0) and Tabla de vueltas (Screen 1)
          if (this.state.currentScreen === 0) {
            this.switchScreen(1)
          } else {
            this.switchScreen(0)
          }
          this.vibrate('short')
          return true
        }
        if (isBottomButton) {
          // Bottom Button: Cycle through the 4 rich summary cards!
          if (this.state.currentScreen !== 0) {
            this.switchScreen(0)
          }
          this.cycleBottomCard()
          return true
        }
      }

      return true
    })
  }
})
