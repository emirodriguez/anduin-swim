import './shared/device-polyfill'
import { MessageBuilder } from './shared/message'

App({
  globalData: {
    activeWorkout: null,
    messageBuilder: null
  },
  onCreate(options) {
    console.log('Anduin App onCreate')
    let appId = 1129005
    if (typeof hmApp !== 'undefined' && typeof hmApp.packageInfo === 'function') {
      try {
        const info = hmApp.packageInfo()
        if (info && info.appId) appId = info.appId
      } catch (e) {}
    }
    try {
      this.globalData.messageBuilder = new MessageBuilder({ appId })
      this.globalData.messageBuilder.connect()
      console.log('MessageBuilder connected successfully with appId:', appId)
    } catch (e) {
      console.log('MessageBuilder connect error:', e)
    }
  },
  onDestroy(options) {
    console.log('Anduin App onDestroy')
    if (this.globalData.messageBuilder) {
      try {
        this.globalData.messageBuilder.disConnect()
      } catch (e) {}
    }
  }
})
