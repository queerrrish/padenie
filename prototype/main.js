// Этап 1.3: шар падает по прямой трубе, ветки торчат из стенок,
// наклон и переворот с датчика телефона, на компьютере с клавиатуры.
// Настройки лежат в config.js. Ось Y направлена вниз, глубина 0 — верх трубы.

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const startScreen = document.getElementById("start");
const startButton = document.getElementById("startButton");
const startMessage = document.getElementById("startMessage");
const restartButton = document.getElementById("restart");

const PHYSICS_STEP = 1 / 60;
const MAX_FRAME_TIME = 0.1;
const SCREEN_ASPECT = 9 / 16;
const WALL_THICKNESS = 1;
const BOTTOM_TOLERANCE = 0.05;
const SENSOR_WAIT_MS = 2000;
const PHASE_NAMES = { fall: "падение", stop: "остановка", rollback: "откат", hover: "зависание" };
const IS_PHONE = window.matchMedia("(pointer: coarse)").matches;
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

let world;
let ball;
let tilt = 0;
let timeBank = 0;
let lastFrameTime = null;
let isRunning = !IS_PHONE;
const keys = { left: false, right: false, flip: false };
const sensor = { hasData: false, angle: 0, tilt: 0, failed: false };
const flip = { phase: "fall", zone: "fall", keyAngle: 0, brakeRate: 0, rollbackStart: null };


// ---------- Физика ----------

function createWall(centerX, centerY, halfWidth, halfHeight) {
  const body = world.createBody();
  body.createFixture(planck.Box(halfWidth, halfHeight, planck.Vec2(centerX, centerY), 0), {
    friction: CONFIG.ballFriction,
  });
}

function branchRect(branch) {
  const innerEdge = CONFIG.pipeWidth / 2;
  const centerX = branch.side === "left"
    ? -innerEdge + branch.length / 2
    : innerEdge - branch.length / 2;
  return {
    centerX,
    centerY: branch.depth,
    halfWidth: branch.length / 2,
    halfHeight: branch.thickness / 2,
  };
}

function createWorld() {
  world = planck.World({ gravity: planck.Vec2(0, CONFIG.fallGravity) });

  const halfWidth = CONFIG.pipeWidth / 2;
  const halfLength = CONFIG.pipeLength / 2;
  const sideHalfHeight = halfLength + WALL_THICKNESS;
  const capHalfWidth = halfWidth + WALL_THICKNESS;

  createWall(-halfWidth - WALL_THICKNESS / 2, halfLength, WALL_THICKNESS / 2, sideHalfHeight);
  createWall(halfWidth + WALL_THICKNESS / 2, halfLength, WALL_THICKNESS / 2, sideHalfHeight);
  createWall(0, -WALL_THICKNESS / 2, capHalfWidth, WALL_THICKNESS / 2);
  createWall(0, CONFIG.pipeLength + WALL_THICKNESS / 2, capHalfWidth, WALL_THICKNESS / 2);

  for (const branch of CONFIG.branches) {
    const rect = branchRect(branch);
    createWall(rect.centerX, rect.centerY, rect.halfWidth, rect.halfHeight);
  }

  ball = world.createBody({
    type: "dynamic",
    position: planck.Vec2(0, CONFIG.ballRadius),
    bullet: true,
    allowSleep: false,
  });
  ball.createFixture(planck.Circle(CONFIG.ballRadius), {
    density: CONFIG.ballDensity,
    friction: CONFIG.ballFriction,
    restitution: CONFIG.ballRestitution,
  });
}

function restart() {
  tilt = 0;
  timeBank = 0;
  flip.phase = "fall";
  flip.zone = "fall";
  flip.keyAngle = 0;
  flip.brakeRate = 0;
  flip.rollbackStart = null;
  createWorld();
}

function limitSpeed() {
  const velocity = ball.getLinearVelocity();
  const speed = velocity.length();
  if (speed > CONFIG.safetyMaxSpeed) {
    velocity.mul(CONFIG.safetyMaxSpeed / speed);
    ball.setLinearVelocity(velocity);
  }
}

function updateTilt(dt) {
  const keyTilt = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const useSensor = sensor.hasData && !keys.left && !keys.right;
  const target = useSensor ? sensor.tilt : keyTilt;
  const rate = useSensor ? CONFIG.sensorTiltRate : CONFIG.keyboardTiltRate;
  const maxChange = rate * dt;
  tilt += Math.max(-maxChange, Math.min(maxChange, target - tilt));
}

function updateKeyFlip(dt) {
  const target = keys.flip ? 180 : 0;
  const maxChange = CONFIG.keyboardFlipSpeed * dt;
  flip.keyAngle += Math.max(-maxChange, Math.min(maxChange, target - flip.keyAngle));
}

function currentPhoneAngle() {
  if (keys.flip || flip.keyAngle > 0 || !sensor.hasData) {
    return flip.keyAngle;
  }
  return sensor.angle;
}

function zoneFromAngle(angle) {
  const size = Math.abs(angle);
  if (size < CONFIG.flipStopStartAngle) {
    return "fall";
  }
  return size < CONFIG.flipRollbackAngle ? "stop" : "rollback";
}

function brakeBall(dt) {
  const velocity = ball.getLinearVelocity();
  const speed = velocity.length();
  const newSpeed = Math.max(0, speed - flip.brakeRate * dt);
  velocity.mul(speed > 0 ? newSpeed / speed : 0);
  ball.setLinearVelocity(velocity);
}

function updateFlip(dt) {
  updateKeyFlip(dt);
  const zone = zoneFromAngle(currentPhoneAngle());

  if (zone !== flip.zone) {
    flip.zone = zone;
    flip.brakeRate = ball.getLinearVelocity().length() / CONFIG.flipBrakeTime;
    flip.rollbackStart = null;
  }

  if (zone === "fall") {
    flip.phase = "fall";
    return planck.Vec2(tilt * CONFIG.sideGravity, CONFIG.fallGravity);
  }

  // Шар сначала тормозит, даже если телефон перевернули одним рывком.
  if (zone === "stop" || (flip.rollbackStart === null && ball.getLinearVelocity().y > 0)) {
    flip.phase = "stop";
    brakeBall(dt);
    return planck.Vec2(0, 0);
  }

  if (flip.rollbackStart === null) {
    flip.rollbackStart = ball.getPosition().y;
  }
  if (flip.rollbackStart - ball.getPosition().y >= CONFIG.rollbackDistance) {
    flip.phase = "hover";
    ball.setLinearVelocity(planck.Vec2(0, 0));
    return planck.Vec2(0, 0);
  }
  flip.phase = "rollback";
  return planck.Vec2(tilt * CONFIG.sideGravity, -CONFIG.fallGravity * CONFIG.rollbackGravityRatio);
}

function stepPhysics(dt) {
  updateTilt(dt);
  world.setGravity(updateFlip(dt));
  world.step(dt);
  limitSpeed();
}


// ---------- Отрисовка ----------

function resizeCanvas() {
  const screenWidth = Math.min(window.innerWidth, window.innerHeight * SCREEN_ASPECT);
  const screenHeight = screenWidth / SCREEN_ASPECT;
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.style.width = screenWidth + "px";
  canvas.style.height = screenHeight + "px";
  canvas.width = Math.round(screenWidth * pixelRatio);
  canvas.height = Math.round(screenHeight * pixelRatio);
}

function drawRect(rect) {
  ctx.fillRect(
    rect.centerX - rect.halfWidth,
    rect.centerY - rect.halfHeight,
    rect.halfWidth * 2,
    rect.halfHeight * 2
  );
}

function drawPipe(viewTop, viewHeight) {
  const halfWidth = CONFIG.pipeWidth / 2;
  const sideWidth = (CONFIG.viewWidth - CONFIG.pipeWidth) / 2;

  ctx.fillStyle = "#4b5259";
  ctx.fillRect(-halfWidth - sideWidth, viewTop, sideWidth, viewHeight);
  ctx.fillRect(halfWidth, viewTop, sideWidth, viewHeight);

  ctx.fillStyle = "#6c757e";
  const firstTick = Math.floor(viewTop / CONFIG.tickSpacing) * CONFIG.tickSpacing;
  for (let y = firstTick; y < viewTop + viewHeight; y += CONFIG.tickSpacing) {
    ctx.fillRect(-halfWidth - sideWidth, y, sideWidth, 0.03);
    ctx.fillRect(halfWidth, y, sideWidth, 0.03);
  }

  ctx.fillStyle = "#4b5259";
  ctx.fillRect(-halfWidth, -WALL_THICKNESS, CONFIG.pipeWidth, WALL_THICKNESS);
  ctx.fillRect(-halfWidth, CONFIG.pipeLength, CONFIG.pipeWidth, WALL_THICKNESS);

  ctx.fillStyle = "#8a6a3f";
  for (const branch of CONFIG.branches) {
    drawRect(branchRect(branch));
  }
}

function drawBall() {
  const position = ball.getPosition();
  const radius = CONFIG.ballRadius;

  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.rotate(ball.getAngle());
  ctx.fillStyle = "#c9ced3";
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3a3f44";
  ctx.beginPath();
  ctx.arc(radius * 0.55, 0, radius * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHud() {
  const position = ball.getPosition();
  const fontSize = canvas.width * 0.04;

  ctx.fillStyle = "#e6e8ea";
  ctx.font = fontSize + "px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Скорость: " + ball.getLinearVelocity().length().toFixed(1) + " м/с", fontSize * 0.7, fontSize * 1.5);
  ctx.fillText("Глубина: " + position.y.toFixed(1) + " / " + CONFIG.pipeLength + " м", fontSize * 0.7, fontSize * 2.8);
  ctx.fillText("Наклон: " + tilt.toFixed(2), fontSize * 0.7, fontSize * 4.1);
  if (sensor.hasData) {
    ctx.fillText("Угол телефона: " + sensor.angle.toFixed(0) + "°", fontSize * 0.7, fontSize * 5.4);
  }
  ctx.fillText("Режим: " + PHASE_NAMES[flip.phase], fontSize * 0.7, fontSize * (sensor.hasData ? 6.7 : 5.4));

  ctx.textAlign = "center";
  if (!IS_PHONE) {
    ctx.fillText("← → или A D: наклон", canvas.width / 2, canvas.height - fontSize * 2.3);
    ctx.fillText("Пробел: переворот   R: заново", canvas.width / 2, canvas.height - fontSize);
  }
  if (sensor.failed && !sensor.hasData) {
    ctx.fillText("Датчик не отвечает", canvas.width / 2, canvas.height - fontSize);
  }

  const atBottom = position.y + CONFIG.ballRadius >= CONFIG.pipeLength - BOTTOM_TOLERANCE;
  if (atBottom) {
    ctx.fillText(IS_PHONE ? "Конец трубы" : "Конец трубы. R: заново", canvas.width / 2, canvas.height / 2);
  }
}

function draw() {
  const scale = canvas.width / CONFIG.viewWidth;
  const viewHeight = canvas.height / scale;
  const viewTop = ball.getPosition().y - viewHeight * CONFIG.cameraBallPosition;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.setTransform(scale, 0, 0, scale, canvas.width / 2, -viewTop * scale);
  drawPipe(viewTop, viewHeight);
  drawBall();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawHud();
}


// ---------- Клавиатура ----------

function setKey(event, isDown) {
  if (event.code === "ArrowLeft" || event.code === "KeyA") {
    keys.left = isDown;
    event.preventDefault();
  } else if (event.code === "ArrowRight" || event.code === "KeyD") {
    keys.right = isDown;
    event.preventDefault();
  } else if (event.code === "Space") {
    keys.flip = isDown;
    event.preventDefault();
  } else if (event.code === "KeyR" && isDown) {
    restart();
  }
}

window.addEventListener("keydown", (event) => setKey(event, true));
window.addEventListener("keyup", (event) => setKey(event, false));
window.addEventListener("blur", () => {
  keys.left = false;
  keys.right = false;
  keys.flip = false;
});
window.addEventListener("resize", resizeCanvas);


// ---------- Датчик телефона ----------

function tiltFromAngle(angle) {
  // Вверх ногами считаем отклонение от 180°: шар идёт туда, куда реально наклонён экран.
  const steering = Math.abs(angle) <= 90 ? angle : Math.sign(angle) * (180 - Math.abs(angle));
  const size = Math.abs(steering) - CONFIG.sensorDeadZoneAngle;
  if (size <= 0) {
    return 0;
  }
  const range = CONFIG.sensorFullTiltAngle - CONFIG.sensorDeadZoneAngle;
  return Math.sign(steering) * Math.min(size / range, 1);
}

function onDeviceMotion(event) {
  const gravity = event.accelerationIncludingGravity;
  if (!gravity || gravity.x === null || gravity.y === null) {
    return;
  }
  // На iOS знаки осей обратные по сравнению с Android.
  const systemSign = IS_IOS ? -1 : 1;
  const sideSign = CONFIG.sensorInvert ? -1 : 1;
  sensor.angle = Math.atan2(-gravity.x * systemSign * sideSign, gravity.y * systemSign) * 180 / Math.PI;
  sensor.tilt = tiltFromAngle(sensor.angle);
  sensor.hasData = true;
}

async function requestSensorPermission() {
  // Разрешение спрашивает только iPhone, и только после нажатия кнопки.
  if (typeof DeviceMotionEvent === "undefined") {
    return false;
  }
  if (typeof DeviceMotionEvent.requestPermission === "function") {
    return (await DeviceMotionEvent.requestPermission()) === "granted";
  }
  return true;
}

async function keepScreenSetup() {
  // Полный экран нужен Android, чтобы закрепить портретную ориентацию.
  // Если что-то из этого недоступно, играть можно и без него.
  try {
    await document.documentElement.requestFullscreen();
    await screen.orientation.lock("portrait");
  } catch (error) {
    console.log("Ориентация не закреплена:", error.message);
  }
  try {
    await navigator.wakeLock.request("screen");
  } catch (error) {
    console.log("Экран может гаснуть:", error.message);
  }
}

async function startOnPhone() {
  // Не ждём результата: на некоторых устройствах этот запрос может не ответить.
  keepScreenSetup();
  let allowed = false;
  try {
    allowed = await requestSensorPermission();
  } catch (error) {
    console.log("Ошибка запроса датчика:", error.message);
  }
  if (!allowed) {
    startMessage.textContent = "Нет доступа к датчику наклона. Разреши датчики движения в настройках сайта и нажми ещё раз.";
    return;
  }

  window.addEventListener("devicemotion", onDeviceMotion);
  window.setTimeout(() => {
    sensor.failed = !sensor.hasData;
  }, SENSOR_WAIT_MS);

  startScreen.style.display = "none";
  restartButton.style.display = "block";
  restart();
  isRunning = true;
}

function setupPhone() {
  startScreen.style.display = "flex";
  if (!window.isSecureContext) {
    startMessage.textContent = "Датчики работают только по HTTPS, открой адрес с https://.";
    startButton.disabled = true;
    return;
  }
  startButton.addEventListener("click", startOnPhone);
  restartButton.addEventListener("click", restart);
}


// ---------- Главный цикл ----------

function frame(now) {
  if (lastFrameTime !== null && isRunning) {
    timeBank += Math.min((now - lastFrameTime) / 1000, MAX_FRAME_TIME);
    while (timeBank >= PHYSICS_STEP) {
      stepPhysics(PHYSICS_STEP);
      timeBank -= PHYSICS_STEP;
    }
  }
  lastFrameTime = now;
  draw();
  requestAnimationFrame(frame);
}

resizeCanvas();
restart();
if (IS_PHONE) {
  setupPhone();
}
requestAnimationFrame(frame);
