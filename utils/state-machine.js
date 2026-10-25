/**
 * State Machine for Swimming Workout App
 * Valid States: READY, RUNNING, PAUSED, FINISHED
 */

export const STATES = {
  READY: 'LISTO',
  RUNNING: 'NADANDO',
  PAUSED: 'DESCANSO',
  FINISHED: 'RESUMEN'
}

export class WorkoutStateMachine {
  constructor(onStateChange) {
    this.currentState = STATES.READY
    this.onStateChange = onStateChange
  }

  getState() {
    return this.currentState
  }

  setState(newState) {
    if (Object.values(STATES).includes(newState)) {
      this.currentState = newState
    }
  }

  transition(action) {
    const prev = this.currentState
    let next = prev

    switch (this.currentState) {
      case STATES.READY:
        if (action === 'TOGGLE' || action === 'START') {
          next = STATES.RUNNING
        }
        break

      case STATES.RUNNING:
        if (action === 'TOGGLE' || action === 'PAUSE') {
          next = STATES.PAUSED
        } else if (action === 'FINISH') {
          next = STATES.FINISHED
        }
        break

      case STATES.PAUSED:
        if (action === 'TOGGLE' || action === 'RESUME') {
          next = STATES.RUNNING
        } else if (action === 'FINISH') {
          next = STATES.FINISHED
        }
        break

      case STATES.FINISHED:
        if (action === 'TOGGLE' || action === 'RESET') {
          next = STATES.READY
        }
        break

      default:
        break
    }

    if (next !== prev) {
      this.currentState = next
      if (typeof this.onStateChange === 'function') {
        this.onStateChange(next, prev)
      }
    }

    return this.currentState
  }
}
