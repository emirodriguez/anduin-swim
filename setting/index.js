AppSettingsPage({
  state: {
    props: {},
    apiKey: '',
    athleteId: '0',
    autoUpload: true
  },

  setState(props) {
    this.state.props = props
    const savedKey = props.settingsStorage.getItem('intervalsApiKey')
    const savedId = props.settingsStorage.getItem('intervalsAthleteId')
    const savedAuto = props.settingsStorage.getItem('intervalsAutoUpload')

    if (savedKey) this.state.apiKey = savedKey
    if (savedId) this.state.athleteId = savedId
    if (savedAuto !== undefined && savedAuto !== null) {
      this.state.autoUpload = savedAuto === 'true' || savedAuto === true
    }
  },

  setStorage(key, val) {
    if (this.state.props.settingsStorage) {
      this.state.props.settingsStorage.setItem(key, String(val))
    }
  },

  build(props) {
    this.setState(props)

    return View(
      {
        style: {
          padding: '16px 20px',
          backgroundColor: '#f8fafc',
          minHeight: '100vh',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }
      },
      [
        // Header
        View(
          {
            style: {
              marginBottom: '20px',
              padding: '16px',
              backgroundColor: '#0284c7',
              borderRadius: '12px',
              color: '#ffffff'
            }
          },
          [
            Text({
              style: {
                fontSize: '18px',
                fontWeight: 'bold',
                color: '#ffffff',
                marginBottom: '6px'
              }
            }, 'Anduin Swim → Intervals.icu'),
            Text({
              style: {
                fontSize: '13px',
                color: '#e0f2fe'
              }
            }, 'Sincronización directa de parciales, brazadas, SWOLF y pulso.')
          ]
        ),

        // Settings Card
        View(
          {
            style: {
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              padding: '16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }
          },
          [
            Text({
              style: {
                fontSize: '14px',
                fontWeight: 'bold',
                color: '#334155',
                marginBottom: '4px'
              }
            }, 'API Key de Intervals.icu'),
            Text({
              style: {
                fontSize: '12px',
                color: '#64748b',
                marginBottom: '8px'
              }
            }, 'Obtenela en Intervals.icu > Settings > Developer Settings'),
            TextInput({
              label: 'Pegá tu API Key acá',
              value: this.state.apiKey,
              subStyle: {
                color: '#0f172a',
                fontSize: '14px'
              },
              onChange: (val) => {
                this.state.apiKey = (val || '').trim()
                this.setStorage('intervalsApiKey', this.state.apiKey)
              }
            }),

            View({ style: { height: '16px' } }),

            Text({
              style: {
                fontSize: '14px',
                fontWeight: 'bold',
                color: '#334155',
                marginBottom: '4px'
              }
            }, 'Athlete ID (Opcional)'),
            Text({
              style: {
                fontSize: '12px',
                color: '#64748b',
                marginBottom: '8px'
              }
            }, 'Dejá "0" para usar tu propia cuenta automáticamente'),
            TextInput({
              label: '0',
              value: this.state.athleteId || '0',
              subStyle: {
                color: '#0f172a',
                fontSize: '14px'
              },
              onChange: (val) => {
                this.state.athleteId = (val || '0').trim()
                this.setStorage('intervalsAthleteId', this.state.athleteId)
              }
            })
          ]
        ),

        // Help info
        View(
          {
            style: {
              marginTop: '16px',
              padding: '12px',
              backgroundColor: '#f1f5f9',
              borderRadius: '8px'
            }
          },
          [
            Text({
              style: {
                fontSize: '12px',
                color: '#475569',
                lineHeight: '18px'
              }
            }, 'Nota: Al finalizar la sesión en el reloj (o seleccionar "Finalizar Sesión"), Anduin transmitirá automáticamente tus largos y métricas a tu calendario de Intervals.icu.')
          ]
        )
      ]
    )
  }
})
