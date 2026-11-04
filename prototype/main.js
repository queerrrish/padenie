// Этап 1.1: шар падает по прямой трубе, ветки торчат из стенок, наклон с клавиатуры.
// Настройки лежат в config.js. Ось Y направлена вниз, глубина 0 — верх трубы.

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const PHYSICS_STEP = 1 / 60;
const MAX_FRAME_TIME = 0.1;
const SCREEN_ASPECT = 9 / 16;
const WALL_THICKNESS = 1;
const BOTTOM_TOLERANCE = 0.05;

let world;
let ball;
let tilt = 0;
let timeBank = 0;
let lastFrameTime = null;
const keys = { left: false, right: false };


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
  const target = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const maxChange = CONFIG.keyboardTiltRate * dt;
  tilt += Math.max(-maxChange, Math.min(maxChange, target - tilt));
}

function stepPhysics(dt) {
  updateTilt(dt);
  world.setGravity(planck.Vec2(tilt * CONFIG.sideGravity, CONFIG.fallGravity));
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

  ctx.textAlign = "center";
  ctx.fillText("← → или A D: наклон   R: заново", canvas.width / 2, canvas.height - fontSize);

  const atBottom = position.y + CONFIG.ballRadius >= CONFIG.pipeLength - BOTTOM_TOLERANCE;
  if (atBottom) {
    ctx.fillText("Конец трубы. R: заново", canvas.width / 2, canvas.height / 2);
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
  } else if (event.code === "KeyR" && isDown) {
    restart();
  }
}

window.addEventListener("keydown", (event) => setKey(event, true));
window.addEventListener("keyup", (event) => setKey(event, false));
window.addEventListener("blur", () => {
  keys.left = false;
  keys.right = false;
});
window.addEventListener("resize", resizeCanvas);


// ---------- Главный цикл ----------

function frame(now) {
  if (lastFrameTime !== null) {
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
requestAnimationFrame(frame);
