/**
 * Workout Timer Module for Zepp OS 1.0
 * Handles swimming intervals, pool length, distance in meters, pace per 100m,
 * net swim time vs total rest time, and lap history.
 */

export class WorkoutTimer {
  constructor(onTick) {
    this.poolLength = 25 // Default 25 meters (can be 25, 50, 20)
    this.totalSeconds = 0
    this.lapSeconds = 0
    this.restSeconds = 0
    this.totalRestSeconds = 0
    this.isResting = false
    this.laps = []
    this.intervalSeconds = 0
    this.intervalMeters = 0
    this.intervalLaps = 0
    this.currentIntervalNumber = 1
    this.lastInterval = null
    this.timerId = null
    this.onTick = onTick
  }

  setPoolLength(length) {
    this.poolLength = length
    this.notify()
  }

  getPoolLength() {
    return this.poolLength
  }

  cyclePoolLength() {
    if (this.poolLength === 25) {
      this.poolLength = 33
    } else if (this.poolLength === 33) {
      this.poolLength = 50
    } else {
      this.poolLength = 25
    }
    this.notify()
    return this.poolLength
  }

  start() {
    this.isResting = false
    this.lastTickTime = Date.now()
    if (this.timerId) return

    this.timerId = timer.createTimer(
      1000,
      1000,
      () => {
        const now = Date.now()
        // Wall-clock delta: never loses seconds even if a tick is delayed
        const delta = Math.max(1, Math.round((now - (this.lastTickTime || now)) / 1000))
        this.lastTickTime = now

        if (!this.isResting) {
          this.totalSeconds += delta
          this.lapSeconds += delta
          this.intervalSeconds += delta
        } else {
          this.restSeconds += delta
          this.totalRestSeconds += delta
        }
        this.notify()
      },
      {}
    )
    this.notify()
  }

  pause(strokes = 0) {
    this.lastTickTime = Date.now()
    // Garmin-style wall finish: only close this length as a lap if the swimmer
    // actually swum across to the wall (at least 12s of swimming AND at least 4 strokes).
    // If paused with < 12s or without strokes, no fake 25m lap is added.
    if (this.lapSeconds >= 12 && strokes >= 4) {
      this.recordLap(this.lapSeconds, 0, strokes)
      this.intervalLaps += 1
      this.intervalMeters += this.poolLength
      this.lapSeconds = 0
    }

    const intMeters = this.intervalMeters
    const intSecs = this.intervalSeconds
    const intPace = this.calculatePace100m(intSecs, intMeters)

    this.lastInterval = {
      intervalNumber: this.currentIntervalNumber,
      seconds: intSecs,
      meters: intMeters,
      laps: this.intervalLaps,
      pace100m: intPace,
      formattedTime: this.formatTime(intSecs)
    }

    this.isResting = true
    this.restSeconds = 0

    // Ensure timer is ticking in pause so rest timer advances
    if (!this.timerId) {
      this.start()
      this.isResting = true
    }
    this.notify()
  }

  resume() {
    this.lastTickTime = Date.now()
    if (this.isResting) {
      // Attach the rest time at the wall to the lap that just finished
      if (this.laps.length > 0 && this.restSeconds > 0) {
        this.laps[this.laps.length - 1].restSeconds = (this.laps[this.laps.length - 1].restSeconds || 0) + this.restSeconds
        this.laps[this.laps.length - 1].formattedRest = this.formatTime(this.laps[this.laps.length - 1].restSeconds)
      }
      this.isResting = false
      this.restSeconds = 0
      this.lapSeconds = 0
      this.intervalSeconds = 0
      this.intervalMeters = 0
      this.intervalLaps = 0
      this.currentIntervalNumber += 1
    }
    // Critical: ensure ticker is running!
    if (!this.timerId) {
      this.start()
    }
    this.notify()
  }

  splitLap(strokes = 0) {
    const lap = this.recordLap(this.lapSeconds, this.restSeconds, strokes)
    this.intervalLaps += 1
    this.intervalMeters += this.poolLength
    this.lapSeconds = 0
    this.restSeconds = 0
    this.notify()
    return lap
  }

  recordLap(lapSecs, restSecs, strokes = 0) {
    const lapNum = this.laps.length + 1
    const lapPace = this.calculatePace100m(lapSecs, this.poolLength)
    const strokeCount = strokes > 0 ? strokes : Math.round(this.poolLength * 0.72)
    const lapSwolf = lapSecs + strokeCount
    const lapData = {
      lapNumber: lapNum,
      seconds: lapSecs,
      restSeconds: restSecs,
      distanceMeters: this.poolLength,
      strokes: strokeCount,
      swolf: lapSwolf,
      pace100m: lapPace,
      formattedLap: this.formatTime(lapSecs),
      formattedRest: this.formatTime(restSecs),
      formattedTotal: this.formatTime(this.totalSeconds),
      accumulatedMeters: lapNum * this.poolLength
    }
    this.laps.push(lapData)
    return lapData
  }

  finish(strokes = 0) {
    if (this.isResting) {
      if (this.laps.length > 0 && this.restSeconds > 0) {
        this.laps[this.laps.length - 1].restSeconds = (this.laps[this.laps.length - 1].restSeconds || 0) + this.restSeconds
        this.laps[this.laps.length - 1].formattedRest = this.formatTime(this.laps[this.laps.length - 1].restSeconds)
      }
    } else {
      // If finished directly from active swimming across pool
      if (this.lapSeconds >= 12 && strokes >= 4) {
        this.recordLap(this.lapSeconds, 0, strokes)
        this.intervalLaps += 1
        this.intervalMeters += this.poolLength
        this.lapSeconds = 0
      }
    }
    if (this.timerId) {
      timer.stopTimer(this.timerId)
      this.timerId = null
    }
    this.isResting = false
    this.notify()
  }

  stopTicking() {
    if (this.timerId) {
      timer.stopTimer(this.timerId)
      this.timerId = null
    }
  }

  serialize() {
    return {
      poolLength: this.poolLength,
      totalSeconds: this.totalSeconds,
      lapSeconds: this.lapSeconds,
      restSeconds: this.restSeconds,
      totalRestSeconds: this.totalRestSeconds,
      intervalSeconds: this.intervalSeconds,
      intervalMeters: this.intervalMeters,
      intervalLaps: this.intervalLaps,
      currentIntervalNumber: this.currentIntervalNumber,
      lastInterval: this.lastInterval,
      isResting: this.isResting,
      laps: this.laps
    }
  }

  deserialize(saved) {
    if (!saved) return
    this.poolLength = saved.poolLength || 25
    this.totalSeconds = saved.totalSeconds || 0
    this.lapSeconds = saved.lapSeconds || 0
    this.restSeconds = saved.restSeconds || 0
    this.totalRestSeconds = saved.totalRestSeconds || 0
    this.intervalSeconds = saved.intervalSeconds || 0
    this.intervalMeters = saved.intervalMeters || 0
    this.intervalLaps = saved.intervalLaps || 0
    this.currentIntervalNumber = saved.currentIntervalNumber || 1
    this.lastInterval = saved.lastInterval || null
    this.isResting = !!saved.isResting
    this.laps = saved.laps || []
    this.notify()
  }

  reset() {
    this.stopTicking()
    this.totalSeconds = 0
    this.lapSeconds = 0
    this.restSeconds = 0
    this.totalRestSeconds = 0
    this.intervalSeconds = 0
    this.intervalMeters = 0
    this.intervalLaps = 0
    this.currentIntervalNumber = 1
    this.lastInterval = null
    this.isResting = false
    this.laps = []
    this.notify()
  }

  calculatePace100m(seconds, meters) {
    if (!meters || meters <= 0 || !seconds || seconds <= 0) return '--:--'
    const paceSecs = Math.round((seconds / meters) * 100)
    return this.formatTime(paceSecs)
  }

  notify() {
    const totalMeters = this.laps.length * this.poolLength
    const avgPace = this.calculatePace100m(this.totalSeconds, totalMeters)
    const lastLap = this.laps.length > 0 ? this.laps[this.laps.length - 1] : null

    let avgSwolf = '--'
    if (this.laps.length > 0) {
      const sumSwolf = this.laps.reduce((acc, l) => acc + (l.swolf || 0), 0)
      avgSwolf = Math.round(sumSwolf / this.laps.length)
    }

    if (typeof this.onTick === 'function') {
      this.onTick({
        formattedTotal: this.formatTime(this.totalSeconds),
        formattedLap: this.formatTime(this.lapSeconds),
        formattedRest: this.formatTime(this.restSeconds),
        formattedTotalRest: this.formatTime(this.totalRestSeconds),
        formattedInterval: this.formatTime(this.intervalSeconds),
        totalSeconds: this.totalSeconds,
        lapSeconds: this.lapSeconds,
        restSeconds: this.restSeconds,
        totalRestSeconds: this.totalRestSeconds,
        intervalSeconds: this.intervalSeconds,
        intervalMeters: this.intervalMeters,
        currentIntervalNumber: this.currentIntervalNumber,
        lastInterval: this.lastInterval,
        intervalPace: this.calculatePace100m(this.intervalSeconds, this.intervalMeters),
        isResting: this.isResting,
        poolLength: this.poolLength,
        totalMeters: totalMeters,
        avgPace100m: avgPace,
        avgSwolf: avgSwolf,
        currentLapNumber: this.laps.length + 1,
        totalLaps: this.laps.length,
        laps: this.laps,
        lastLap: lastLap
      })
    }
  }

  formatTime(totalSecs) {
    const mins = Math.floor(totalSecs / 60)
    const secs = totalSecs % 60
    const mm = mins < 10 ? `0${mins}` : `${mins}`
    const ss = secs < 10 ? `0${secs}` : `${secs}`
    return `${mm}:${ss}`
  }

  getLaps() {
    return this.laps
  }

  getStats() {
    const totalMeters = this.laps.length * this.poolLength
    if (this.laps.length === 0) {
      return {
        bestLap: '00:00',
        avgLap: '00:00',
        totalTime: this.formatTime(this.totalSeconds),
        totalRestTime: this.formatTime(this.totalRestSeconds),
        totalMeters: 0,
        avgPace: '--:--',
        bestPace: '--:--',
        calories: 0,
        avgSwolf: '--',
        bestSwolf: '--',
        totalLaps: 0
      }
    }
    let minSecs = this.laps[0].seconds
    let sumSecs = 0
    let bestSwolf = 999
    let sumSwolf = 0
    let swolfCount = 0

    this.laps.forEach((l) => {
      if (l.seconds < minSecs) minSecs = l.seconds
      sumSecs += l.seconds
      if (l.swolf && l.swolf > 0) {
        if (l.swolf < bestSwolf) bestSwolf = l.swolf
        sumSwolf += l.swolf
        swolfCount++
      }
    })
    const avgSecs = Math.round(sumSecs / this.laps.length)
    const avgPace = this.calculatePace100m(this.totalSeconds, totalMeters)
    const bestPace = this.calculatePace100m(minSecs, this.poolLength)
    const avgSwolf = swolfCount > 0 ? Math.round(sumSwolf / swolfCount) : '--'
    const bestSwolfVal = bestSwolf < 999 ? bestSwolf : '--'

    // Swimming estimates ~9 kcal per minute of active swimming
    const activeMinutes = this.totalSeconds / 60
    const estimatedCalories = Math.round(activeMinutes * 9)

    return {
      bestLap: this.formatTime(minSecs),
      avgLap: this.formatTime(avgSecs),
      totalTime: this.formatTime(this.totalSeconds),
      totalRestTime: this.formatTime(this.totalRestSeconds),
      totalMeters: totalMeters,
      avgPace: avgPace,
      bestPace: bestPace,
      calories: estimatedCalories,
      avgSwolf: avgSwolf,
      bestSwolf: bestSwolfVal,
      totalLaps: this.laps.length
    }
  }
}
