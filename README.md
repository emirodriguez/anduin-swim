# 🏊 Anduin — Pro Swimming App for Amazfit GTR 3 Pro (Zepp OS 1.0)

[![Zepp OS](https://img.shields.io/badge/Zepp%20OS-1.0-blue.svg)](https://docs.zepp.com/)
[![Intervals.icu](https://img.shields.io/badge/Sync-Intervals.icu-orange.svg)](https://intervals.icu/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Anduin** es una aplicación de natación profesional para el **Amazfit GTR 3 Pro** (Zepp OS 1.0), diseñada específicamente para nadadores de pileta que buscan telemetría en tiempo real, control 100% físico en el agua y sincronización directa automática con **Intervals.icu** (y de ahí a Strava).

---

## ⚡ ¿Por qué Anduin?

La aplicación nativa de natación de Zepp OS tiene limitaciones para nadadores exigentes:
1. **Gotas de agua y pantalla táctil:** Las gotas producen toques fantasmas o salidas involuntarias. En Anduin, **los gestos táctiles están desactivados** y todo el control se hace por botones físicos y corona rotatoria.
2. **Telemetría en tiempo real:** Muestra ritmo cada 100m, SWOLF instantáneo, pulso cardíaco en vivo por zonas de color, y tiempo de descanso con recuperación cardíaca en pared.
3. **Exportación directa:** Genera archivos TCX estándar de natación Garmin (con resolución de 1 segundo, curvas de ritmo, pulso, brazadas y descansos en pared) y los sube automáticamente a Intervals.icu vía Bluetooth.

---

## ✨ Características Principales

- **🎮 Control 100% por Hardware:** Corona superior (iniciar/pausar/reanudar/finalizar), corona rotatoria (cambio de pantalla) y botón inferior (cambio de métricas y vuelta manual).
- **⏱️ Cronómetro con Detección de Pared (Filtro Garmin):** Al tocar la pared y presionar Pausa, solo computa los 25m si nadaste al menos 12 segundos y diste más de 4 brazadas, evitando largos falsos al acomodarte las antiparras.
- **❤️ Frecuencia Cardíaca y Recuperación:** Sensor PPG continuo con zonas de entrenamiento (Calentamiento, Aeróbico, Umbral, Anaeróbico, Máximo) y cálculo automático de caída de pulso durante el descanso en pared.
- **🏊 Métricas de Nado:** Distancia acumulada (pileta de 25m, 33m o 50m), ritmo cada 100m, conteo de brazadas y puntaje SWOLF por largo.
- **🛡️ Resiliencia a Notificaciones:** La sesión se persiste periódicamente en la memoria flash interna del reloj. Si entra un mensaje de WhatsApp o una llamada, el entrenamiento no se pierde y al volver a la app continúa en el segundo exacto.
- **☁️ Sincronización Automática con Intervals.icu:** Al finalizar la sesión, el servicio companion de la app Zepp del celular sube el entrenamiento vía API de archivo TCX nativo (`Sport="Swimming"`, parciales y descansos `Intensity="Resting"`).

---

## 🎮 Controles Físicos (Machete de Pileta)

| Acción | Botón | Función |
| :--- | :--- | :--- |
| **Iniciar / Pausar / Reanudar** | **Corona (Pulsar)** | Alterna entre nado activo y descanso en pared. |
| **Cambiar pantalla** | **Corona (Girar)** | Rota entre: <br>• **Pantalla 0:** HUD Principal.<br>• **Pantalla 1:** Tabla de todas tus vueltas.<br>• **Pantalla 2:** Ajustes y Finalizar. |
| **Cambiar métrica inferior** | **Botón Abajo (Clic)** | Rota la tarjeta inferior entre: *Ritmo /100m*, *SWOLF*, *Pulso/Zona*, *Recuperación* y *Telemetría*. |
| **Vuelta Manual forzada** | **Botón Abajo (Sostener)** | Fuerza el marcado de un largo de 25m inmediatamente con confirmación vibratoria (ideal para series de patada). |
| **Cambiar largo de pileta** | **Pantalla 2 $\rightarrow$ Botón Abajo** | Alterna entre piletas de **25m**, **33m** y **50m**. |
| **Finalizar y Sincronizar** | **Pantalla 2 $\rightarrow$ Corona** | Finaliza la sesión, guarda el resumen y lo sube directo a Intervals.icu. |

---

## 📲 Configuración con Intervals.icu

1. Abrí tu cuenta en [Intervals.icu](https://intervals.icu/) y andá a **Settings / Ajustes** (abajo del todo).
2. Copiá tu **API Key** personal y tu **Athlete ID** (el ID que empieza con `i...` o usá `0`).
3. En tu celular, abrí la app **Zepp** $\rightarrow$ *Perfil* $\rightarrow$ *Amazfit GTR 3 Pro* $\rightarrow$ *Anduin* (Ajustes de la app).
4. Pegá tu API Key y tu Athlete ID. ¡Listo! Cada sesión que termines en el reloj subirá sola.

> [!TIP]
> **Recomendación para Intervals.icu:** 
> En Intervals.icu, andá a *Ajustes $\rightarrow$ Natación (Swim)* y tildá la casilla **«Usar laps»** (o *Use device laps*). De este modo, Intervals.icu respetará siempre los parciales y descansos exactos del reloj en lugar de intentar adivinarlos.

---

## 🛠️ Instalación y Compilación para Desarrolladores

### Requisitos:
- Node.js (v18 o v20 recomendado).
- CLI oficial de Zepp OS:
  ```bash
  npm install -g @zeppos/zeus-cli
  ```

### Clonar y preparar:
```bash
git clone https://github.com/TU_USUARIO/anduin-swimming-gtr.git
cd anduin-swimming-gtr
npm install
```

### Probar en el reloj (Preview):
```bash
zeus preview
```
Escaneá el código QR resultante desde la app **Zepp** (*Perfil $\rightarrow$ Amazfit GTR 3 Pro $\rightarrow$ Modo Desarrollador*).

---

## 📂 Arquitectura del Proyecto

```text
├── app.json             # Configuración del paquete Zepp OS, permisos y targets
├── app.js               # Ciclo de vida global e inicialización de MessageBuilder
├── page/
│   └── index.js         # Interfaz visual del reloj, máquina de estados y sensores (PPG, acelerómetro)
├── app-side/
│   └── index.js         # Companion service en el teléfono: generador TCX y cliente REST para Intervals.icu
├── setting/
│   └── index.js         # Pantalla de ajustes en la app Zepp del teléfono (API Key y Athlete ID)
├── utils/
│   ├── timer.js         # Cronómetro de nado, cálculo de laps, descansos, SWOLF y ritmos
│   └── state-machine.js # Máquina de estados (READY, RUNNING, PAUSED, FINISHED)
└── shared/
    └── message.js       # Protocolo de mensajería BLE reloj-celular
```

---

## 📄 Licencia

Este proyecto está bajo la licencia [MIT](LICENSE). Podés usarlo, modificarlo y compartirlo libremente.
