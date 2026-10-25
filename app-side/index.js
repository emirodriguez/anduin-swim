import { MessageBuilder } from '../shared/message'

const messageBuilder = new MessageBuilder()

function escapeXml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function generateTCX(workout, description) {
  const startTime = new Date(workout.startTime || Date.now()).toISOString()
  const poolLen = workout.poolLength || 25
  const rawLaps = workout.laps || []
  const totalMeters = typeof workout.totalMeters === 'number' ? workout.totalMeters : (rawLaps.length * poolLen)
  const totalSecs = Math.max(1, workout.totalSeconds || 1)
  const calories = workout.calories || Math.round(totalMeters * 0.28)
  const avgHr = workout.heartRate || workout.avgHeartRate || 120
  const maxHr = workout.peakHeartRate || Math.max(avgHr, 130)

  // Build laps list: if empty (e.g. quick test), synthesize 1 lap matching actual meters
  const laps = rawLaps.length > 0 ? rawLaps : [
    {
      lapNumber: 1,
      seconds: totalSecs,
      distanceMeters: totalMeters,
      strokes: workout.totalStrokes || 0,
      heartRate: avgHr,
      restSeconds: 0
    }
  ]

  let lapXML = ''
  let currentTimestamp = new Date(workout.startTime || Date.now()).getTime()
  let cumDistance = 0

  laps.forEach((lap) => {
    const lapSecs = Math.max(1, lap.seconds || lap.lapSeconds || 25)
    const dist = lap.distanceMeters || poolLen
    const lapHr = lap.heartRate || avgHr
    const strokes = lap.strokes || Math.round(dist * 0.65)
    
    // Cadence in strokes per minute (swimming range: 20 to 60 SPM to prevent crazy spikes on test clicks)
    const rawSpm = lapSecs > 0 ? Math.round((strokes / lapSecs) * 60) : strokes
    const spm = Math.min(60, Math.max(20, rawSpm))
    const speed = (dist / lapSecs).toFixed(2)

    const lapStart = new Date(currentTimestamp).toISOString()
    const step = lapSecs <= 4 ? 1 : Math.max(1, Math.round(lapSecs / Math.min(lapSecs, 15)))
    let trackpointsXML = ''

    for (let t = 0; t <= lapSecs; t += step) {
      const pTime = new Date(currentTimestamp + (t * 1000)).toISOString()
      const frac = t / lapSecs
      const pDist = Math.round((cumDistance + (frac * dist)) * 10) / 10

      trackpointsXML += `
          <Trackpoint>
            <Time>${pTime}</Time>
            <DistanceMeters>${pDist}</DistanceMeters>
            ${lapHr > 0 ? `<HeartRateBpm><Value>${lapHr}</Value></HeartRateBpm>` : ''}
            <Cadence>${spm}</Cadence>
            <Extensions>
              <TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
                <Speed>${speed}</Speed>
              </TPX>
            </Extensions>
          </Trackpoint>`
    }

    currentTimestamp += lapSecs * 1000
    cumDistance += dist

    lapXML += `
      <Lap StartTime="${lapStart}">
        <TotalTimeSeconds>${lapSecs}</TotalTimeSeconds>
        <DistanceMeters>${dist}</DistanceMeters>
        <Calories>${Math.round(dist * 0.28)}</Calories>
        ${lapHr > 0 ? `<AverageHeartRateBpm><Value>${lapHr}</Value></AverageHeartRateBpm>` : ''}
        ${maxHr > 0 ? `<MaximumHeartRateBpm><Value>${maxHr}</Value></MaximumHeartRateBpm>` : ''}
        <Intensity>Active</Intensity>
        <Cadence>${spm}</Cadence>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>${trackpointsXML}
        </Track>
      </Lap>`

    // Resting interval at wall if any
    const restSecs = lap.restSeconds || 0
    if (restSecs > 0) {
      const restStart = new Date(currentTimestamp).toISOString()
      const recoveredHr = Math.max(50, lapHr - (workout.lastRecoveryBpm || 10))
      const avgRestHr = Math.round((lapHr + recoveredHr) / 2)
      const restStep = restSecs <= 4 ? 1 : Math.max(1, Math.round(restSecs / Math.min(restSecs, 10)))
      let restTrackpointsXML = ''

      for (let rt = 0; rt <= restSecs; rt += restStep) {
        const rpTime = new Date(currentTimestamp + (rt * 1000)).toISOString()
        const rFrac = rt / restSecs
        const curHr = Math.round(lapHr - (rFrac * (lapHr - recoveredHr)))

        restTrackpointsXML += `
          <Trackpoint>
            <Time>${rpTime}</Time>
            <DistanceMeters>${cumDistance}</DistanceMeters>
            <HeartRateBpm><Value>${curHr}</Value></HeartRateBpm>
            <Cadence>0</Cadence>
            <Extensions>
              <TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
                <Speed>0.0</Speed>
              </TPX>
            </Extensions>
          </Trackpoint>`
      }

      currentTimestamp += restSecs * 1000

      lapXML += `
      <Lap StartTime="${restStart}">
        <TotalTimeSeconds>${restSecs}</TotalTimeSeconds>
        <DistanceMeters>0.0</DistanceMeters>
        <Calories>1</Calories>
        <AverageHeartRateBpm><Value>${avgRestHr}</Value></AverageHeartRateBpm>
        <Intensity>Resting</Intensity>
        <Cadence>0</Cadence>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>${restTrackpointsXML}
        </Track>
      </Lap>`
    }
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">
  <Activities>
    <Activity Sport="Swimming">
      <Id>${startTime}</Id>
      ${lapXML}
      <Notes>${escapeXml(description)}</Notes>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`
}

async function uploadToIntervals(ctx, workout) {
  try {
    const apiKey = settings.settingsStorage.getItem('intervalsApiKey')
    const athleteId = settings.settingsStorage.getItem('intervalsAthleteId') || '0'

    if (!apiKey || !apiKey.trim()) {
      console.log('[INTERVALS] Error: No API Key configured in Zepp app settings')
      ctx.response({
        data: {
          success: false,
          error: 'NO_API_KEY',
          message: 'Falta configurar la API Key en la app Zepp del celular'
        }
      })
      return
    }

    const authHeader = 'Basic ' + Buffer.from('API_KEY:' + apiKey.trim()).toString('base64')
    const startDate = new Date(workout.startTime || Date.now()).toISOString().replace('Z', '')
    const totalMeters = workout.totalMeters || 0
    const netSwimSecs = workout.totalSeconds || 0
    const restSecs = workout.totalRestSeconds || 0
    const elapsedSecs = netSwimSecs + restSecs

    const formatSecs = (s) => {
      const m = Math.floor(s / 60)
      const sec = s % 60
      return `${m < 10 ? '0' : ''}${m}:${sec < 10 ? '0' : ''}${sec}`
    }

    // Build Lap table summary for notes
    let lapSummary = ''
    if (workout.laps && workout.laps.length > 0) {
      lapSummary = '\n\nDetalle de parciales:\n' + workout.laps.map(l => 
        `• Vta ${l.lapNumber}: ${l.distanceMeters || workout.poolLength || 25}m en ${l.formattedLap || (l.seconds || l.lapSeconds) + 's'} | Ritmo: ${l.pace100m || '--'} | SWOLF: ${l.swolf || '--'} | Brazadas: ${l.strokes || 0}`
      ).join('\n')
    }

    const description = `Sesión registrada con Anduin en Amazfit GTR 3 Pro.
• Distancia: ${totalMeters}m (Pileta ${workout.poolLength || 25}m)
• Tiempo total: ${formatSecs(elapsedSecs)} (Nado neto: ${formatSecs(netSwimSecs)})
• Descanso en pared: ${formatSecs(restSecs)}
• Ritmo medio: ${workout.avgPace100m || '--'} /100m
• SWOLF medio: ${workout.avgSwolf || '--'}
• Pulso medio: ${workout.heartRate || '--'} bpm (Pico: ${workout.peakHeartRate || '--'} bpm)
• Recuperación en pared: -${workout.lastRecoveryBpm || 0} bpm${lapSummary}`

    console.log('[INTERVALS] Subiendo a https://intervals.icu/api/v1/athlete/' + athleteId + '...')

    // Attempt 1: Upload multipart TCX file for complete lap and stream breakdown
    const tcxData = generateTCX(workout, description)
    const boundary = '----WebKitFormBoundaryAnduin' + Date.now()
    const multipartBody = 
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="anduin_swim_${Date.now()}.tcx"\r\n` +
      `Content-Type: application/vnd.garmin.tcx+xml\r\n\r\n` +
      `${tcxData}\r\n` +
      `--${boundary}--\r\n`

    let uploadOk = false
    let isFileActivity = false

    try {
      // Use clean URL with '+' for spaces and no accents to prevent mobile runtime double-encoding '%25' bugs
      // The full rich description with bullet points is embedded natively in <Notes> inside the TCX file!
      const uploadUrl = `https://intervals.icu/api/v1/athlete/${athleteId}/activities?name=Natacion+en+Pileta+(${totalMeters}m)`
      const res = await fetch({
        url: uploadUrl,
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(Buffer.byteLength(multipartBody))
        },
        body: multipartBody
      })

      const status = res ? res.status : 0
      const bodyTxt = res ? (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)) : 'null'
      console.log('[INTERVALS] TCX upload status:', status, 'Body:', bodyTxt)

      if (status === 200 || status === 201) {
        uploadOk = true
        isFileActivity = true
        console.log('[INTERVALS] ¡Subida exitosa de archivo TCX con intervalos y curvas!')
      } else {
        console.log('[INTERVALS] TCX no aceptado (' + status + '), probando endpoint manual JSON...')
      }
    } catch (e) {
      console.log('[INTERVALS] Exception en TCX upload:', e, '- probando endpoint manual JSON...')
    }

    // Attempt 2 (Fallback): Direct JSON manual activity creation
    if (!uploadOk) {
      const manualUrl = `https://intervals.icu/api/v1/athlete/${athleteId}/activities/manual`
      const manualPayload = {
        name: `Natación en Pileta (${totalMeters}m)`,
        type: 'Swim',
        start_date_local: startDate,
        distance: totalMeters,
        moving_time: Math.max(1, netSwimSecs),
        elapsed_time: Math.max(1, elapsedSecs),
        average_heartrate: workout.heartRate || workout.avgHeartRate || undefined,
        max_heartrate: workout.peakHeartRate || undefined,
        calories: workout.calories || Math.round(totalMeters * 0.28),
        description: description,
        external_id: 'anduin_' + (workout.startTime || Date.now())
      }

      const resManual = await fetch({
        url: manualUrl,
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(manualPayload)
      })

      const manualStatus = resManual ? resManual.status : 0
      if (manualStatus === 200 || manualStatus === 201) {
        uploadOk = true
        console.log('[INTERVALS] Subida exitosa vía endpoint manual JSON')
      } else {
        const bodyTxt = resManual ? (typeof resManual.body === 'string' ? resManual.body : JSON.stringify(resManual.body)) : 'null'
        console.log('[INTERVALS] Error en endpoint manual:', manualStatus, bodyTxt)
        throw new Error('Intervals.icu rechazó la subida (Status ' + manualStatus + ')')
      }
    }

    ctx.response({
      data: {
        success: true,
        isFile: isFileActivity,
        message: isFileActivity ? '¡Sesión y parciales subidos a Intervals.icu!' : '¡Sesión subida como entrada manual!'
      }
    })
  } catch (error) {
    console.log('[INTERVALS] Exception:', error)
    ctx.response({
      data: {
        success: false,
        error: error.message || 'Error de conexión con Intervals.icu'
      }
    })
  }
}


AppSideService({
  onInit() {
    messageBuilder.listen(() => {})

    messageBuilder.on('request', (ctx) => {
      const payload = messageBuilder.buf2Json(ctx.request.payload)
      console.log('[APP-SIDE] Request recibido de reloj:', payload ? payload.method : 'unknown')

      if (payload && payload.method === 'UPLOAD_TO_INTERVALS') {
        return uploadToIntervals(ctx, payload.params || {})
      } else if (payload && payload.method === 'CHECK_CONFIG') {
        const apiKey = settings.settingsStorage.getItem('intervalsApiKey')
        ctx.response({
          data: {
            hasApiKey: Boolean(apiKey && apiKey.trim())
          }
        })
      }
    })
  },

  onRun() {},
  onDestroy() {}
})
