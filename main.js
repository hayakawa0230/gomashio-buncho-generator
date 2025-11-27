// ゲームセッション状態
function createSession() {
    return {
        currentStage: 1,
        remainingSprinkles: 5,
        isHolding: false,
        powerGauge: 0,
        gaugeDirection: 1,
        packageAnim: null,
        transitionFlashFrames: 0,
        isTransitioningStage: false,
        isDraggingSlider: false,
        activeParticles: [],
        settledParticles: [],
        sesameRatio: 0.5,
        maskType: 'magao' // デフォルト
    };
}
let session = createSession();

// 最近作成した画像を保存・読み込み
const RECENT_KEY = 'gomasio-recent';
const RECENT_MAX = 5;
function loadRecentImages() {
    try {
        const data = localStorage.getItem(RECENT_KEY);
        if (!data) return [];
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed.slice(0, RECENT_MAX) : [];
    } catch (e) {
        console.error('Failed to load recent images', e);
        return [];
    }
}

function saveRecentImage(dataUrl) {
    const list = loadRecentImages();
    list.unshift(dataUrl);
    const trimmed = list.slice(0, RECENT_MAX);
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed));
    } catch (e) {
        console.error('Failed to save recent images', e);
    }
    renderRecentImages(trimmed);
}

function renderRecentImages(list = loadRecentImages()) {
    if (!recentListEl) return;
    recentListEl.innerHTML = '';
    if (!list.length) {
        recentListEl.textContent = 'まだありません';
        return;
    }
    list.forEach((src) => {
        const img = document.createElement('img');
        img.src = src;
        img.className = 'recent-thumb';
        img.alt = '最近作ったごましお文鳥';
        img.addEventListener('click', () => {
            // 保存画面に遷移しつつ生成はスキップしてサムネを表示
            switchStage(3, { skipGenerate: true });
            const previewImage = document.getElementById('previewImage');
            const overlayPreview = document.getElementById('overlayPreview');
            previewImage.src = src;
            if (overlayPreview) {
                overlayPreview.src = maskImage.src;
            }
        });
        recentListEl.appendChild(img);
    });
}

// Canvas要素
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const cropCanvas = document.getElementById('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');
const previewCanvas = document.getElementById('previewCanvas');
const previewCtx = previewCanvas.getContext('2d');

// ディスプレイサイズとキャンバス内部座標を一致させるためのユーティリティ
function getPointerPosition(evt, targetCanvas) {
    const rect = targetCanvas.getBoundingClientRect();
    const touch = (evt.touches && evt.touches[0]) || (evt.changedTouches && evt.changedTouches[0]);
    const clientX = touch ? touch.clientX : evt.clientX;
    const clientY = touch ? touch.clientY : evt.clientY;

    const scaleX = targetCanvas.width / rect.width;
    const scaleY = targetCanvas.height / rect.height;
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

// パッケージ画像の読み込み
const packageImage = new Image();
packageImage.src = 'assets/package.png';


// マスク画像定義
const MASK_TYPES = {
    magao: {
        mask: 'assets/magao-mask.png',
        maskNoBg: 'assets/magao-mask-nobg.png'
    },
    magaoNoago: {
        mask: 'assets/magao-noago-mask.png',
        maskNoBg: 'assets/magao-noago-mask-nobg.png'
    },
    buchigire: {
        mask: 'assets/buchigire-mask.png',
        maskNoBg: 'assets/buchigire-mask-nobg.png'
    },
    buchigireNoago: {
        mask: 'assets/buchigire-noago-mask.png',
        maskNoBg: 'assets/buchigire-noago-mask-nobg.png'
    }
};

// マスク画像の読み込み
const maskImage = new Image();
maskImage.crossOrigin = "anonymous";
let maskLoaded = false;

const maskNoBgImage = new Image();
let maskNoBgLoaded = false;

function loadMaskImages(type) {
    maskLoaded = false;
    maskNoBgLoaded = false;


    if (!MASK_TYPES[type]) {
        console.error('Invalid mask type:', type);
    }

    const paths = MASK_TYPES[type] || MASK_TYPES.magao;

    maskImage.src = paths.mask;
    maskNoBgImage.src = paths.maskNoBg;
}

maskImage.onload = () => {
    console.log('Mask image loaded successfully');
    maskLoaded = true;
    if (session.currentStage === 2) {
        drawCropCircle();
    }
};

maskImage.onerror = () => {
    console.error('Failed to load mask image');
};

maskNoBgImage.onload = () => {
    maskNoBgLoaded = true;
    if (session.currentStage === 2) {
        drawCropCircle();
    }
};

// オフスクリーンキャンバス
const offscreenCanvas = document.createElement('canvas');
offscreenCanvas.width = canvas.width;
offscreenCanvas.height = canvas.height;
const offscreenCtx = offscreenCanvas.getContext('2d');

let gaugeSpeed = 0.025;

// 切り抜き用（マスク画像のサイズと位置）
// 切り抜き初期サイズを少し小さめにする
let cropMask = { x: 240, y: 160, width: 140, height: 140 };
let isDraggingCircle = false;
let isDraggingResize = false;
let dragOffset = { x: 0, y: 0 };

// UI要素
const ratioSlider = document.getElementById('ratioSlider');
const ratioHandle = document.getElementById('ratioHandle');
const ratioFill = document.getElementById('ratioFill');
const saltPercentEl = document.getElementById('saltPercent');
const sesamePercentEl = document.getElementById('sesamePercent');
const remainingCountEl = document.getElementById('remainingCount');
const stageInfoEl = document.getElementById('stageInfo');
const recentListEl = document.getElementById('recentList');

// ミッション切り替え
function switchStage(stage, options = {}) {
    const { skipGenerate = false } = options;
    // ステージ1に戻るときはセッションを丸ごとリセット
    if (stage === 1) {
        const currentMaskType = session.maskType;
        session = createSession();
        session.maskType = currentMaskType;
    } else {
        session.currentStage = stage;
        // ステージ間の遷移中フラグは明示的に解除
        session.isTransitioningStage = false;
        session.transitionFlashFrames = 0;
    }

    document.getElementById('stage1').classList.add('hidden');
    document.getElementById('stage2').classList.add('hidden');
    document.getElementById('stage3').classList.add('hidden');

    if (stage === 1) {
        stageInfoEl.textContent = 'ミッション1: ごましおを振れ！';
        document.getElementById('stage1').classList.remove('hidden');
        remainingCountEl.textContent = session.remainingSprinkles;
        offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
        session.activeParticles = [];
        session.settledParticles = [];

        // ゲージとアニメーション状態をリセット
        session.isHolding = false;
        session.powerGauge = 0;
        session.gaugeDirection = 1;
        session.packageAnim = null;

        // 切り抜きマスク位置を初期値に戻す
        cropMask = { x: 240, y: 160, width: 140, height: 140 };
        isDraggingCircle = false;
        isDraggingResize = false;
        dragOffset = { x: 0, y: 0 };
        session.sesameRatio = 0.5;
        updateSliderPosition();
    } else if (stage === 2) {
        stageInfoEl.textContent = 'ミッション2: 切り抜け！';
        document.getElementById('stage2').classList.remove('hidden');
        cropCtx.drawImage(offscreenCanvas, 0, 0);
        drawCropCircle();
    } else if (stage === 3) {
        stageInfoEl.textContent = 'ミッション3: 保存せよ！';
        document.getElementById('stage3').classList.remove('hidden');
        if (!skipGenerate) {
            createCroppedImage();
        }
    }

    // 全ステージで最近リストを表示更新
    renderRecentImages();
}

// スライダーの初期位置設定
function updateSliderPosition() {
    const sliderWidth = ratioSlider.offsetWidth;
    const handlePos = session.sesameRatio * sliderWidth;
    ratioHandle.style.left = handlePos + 'px';
    ratioFill.style.width = ((1 - session.sesameRatio) * 100) + '%';

    const saltPercent = Math.round((1 - session.sesameRatio) * 100);
    const sesamePercent = Math.round(session.sesameRatio * 100);
    saltPercentEl.textContent = saltPercent;
    sesamePercentEl.textContent = sesamePercent;
}

function handleSliderMove(clientX) {
    const rect = ratioSlider.getBoundingClientRect();
    const x = clientX - rect.left;
    session.sesameRatio = Math.max(0, Math.min(1, x / rect.width));
    updateSliderPosition();
}

// スライダーイベント
ratioSlider.addEventListener('mousedown', (e) => {
    session.isDraggingSlider = true;
    handleSliderMove(e.clientX);
});

document.addEventListener('mousemove', (e) => {
    if (session.isDraggingSlider) {
        handleSliderMove(e.clientX);
    }
});

document.addEventListener('mouseup', () => {
    session.isDraggingSlider = false;
});

ratioSlider.addEventListener('touchstart', (e) => {
    e.preventDefault();
    session.isDraggingSlider = true;
    handleSliderMove(e.touches[0].clientX);
});

ratioSlider.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (session.isDraggingSlider) {
        handleSliderMove(e.touches[0].clientX);
    }
});

ratioSlider.addEventListener('touchend', (e) => {
    e.preventDefault();
    session.isDraggingSlider = false;
});

// ウィンドウ幅が変わったら位置を再計算（レスポンシブ対応）
window.addEventListener('resize', updateSliderPosition);

// パーティクルクラス
class Particle {
    constructor(x, y, angle, isBlack, power) {
        this.startX = x;
        this.startY = y;
        this.x = x;
        this.y = y;
        this.z = 0;

        const speed = (Math.random() * 2 + 1) * (0.5 + power * 2.5);
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.vz = (Math.random() * 1.5 + 0.5) * (0.5 + power * 2.5);

        this.baseSize = Math.random() * 7 + 5;
        this.isBlack = isBlack;
        this.rotation = Math.random() * Math.PI * 2;
        this.rotationSpeed = (Math.random() - 0.5) * 0.15;
        this.settled = false;
        this.maxZ = Math.random() * 15 + 10;
    }

    update() {
        if (!this.settled) {
            this.z += this.vz;
            this.x += this.vx;
            this.y += this.vy;
            this.rotation += this.rotationSpeed;

            this.vx *= 0.95;
            this.vy *= 0.95;
            this.vz *= 0.92;

            if (this.z >= this.maxZ || Math.abs(this.vz) < 0.01) {
                this.settled = true;
                this.vx = 0;
                this.vy = 0;
                this.vz = 0;
                this.drawToOffscreen();
                session.settledParticles.push({
                    x: this.x,
                    y: this.y,
                    z: this.z,
                    rotation: this.rotation,
                    baseSize: this.baseSize,
                    isBlack: this.isBlack
                });
                return false;
            }
        }
        return !this.settled;
    }

    draw(context) {
        const scale = 1 / (1 + this.z * 0.05);
        const size = this.baseSize * scale;

        if (size < 0.5) return;

        context.save();
        context.translate(this.x, this.y);
        context.rotate(this.rotation);

        if (this.isBlack) {
            context.fillStyle = '#000000';
            context.beginPath();
            context.ellipse(0, 0, size, size * 0.6, 0, 0, Math.PI * 2);
            context.fill();
        } else {
            context.fillStyle = '#f5f5f5';
            context.strokeStyle = '#ddd';
            context.lineWidth = 0.5 * scale;
            context.beginPath();
            context.rect(-size / 2, -size / 2, size, size);
            context.fill();
            context.stroke();
        }

        context.restore();
    }

    drawToOffscreen() {
        this.draw(offscreenCtx);
    }
}

function sprinkle(x, y, power) {
    console.log('Sprinkle called:', x, y, power, session.remainingSprinkles);
    if (session.remainingSprinkles <= 0 || session.isTransitioningStage) return;

    const particleCount = Math.round((Math.random() * 50 + 100) * (0.5 + power));
    console.log('Creating particles:', particleCount);

    for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const isBlack = Math.random() < session.sesameRatio;
        session.activeParticles.push(new Particle(x, y, angle, isBlack, power));
    }

    console.log('Active particles:', session.activeParticles.length);
    session.remainingSprinkles--;
    remainingCountEl.textContent = session.remainingSprinkles;

    if (session.remainingSprinkles === 0) {
        session.isTransitioningStage = true;
        session.transitionFlashFrames = 25;
        setTimeout(() => {
            switchStage(2);
        }, 500);
    }
}

function drawPowerGauge() {
    if (!session.isHolding) return;

    const gaugeWidth = 300;
    const gaugeHeight = 40;
    const gaugeX = (canvas.width - gaugeWidth) / 2;
    const gaugeY = 30;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(gaugeX - 5, gaugeY - 5, gaugeWidth + 10, gaugeHeight + 10);

    ctx.fillStyle = '#f3eee7';
    ctx.fillRect(gaugeX, gaugeY, gaugeWidth, gaugeHeight);

    const gradient = ctx.createLinearGradient(gaugeX, 0, gaugeX + gaugeWidth, 0);
    gradient.addColorStop(0, '#f7d7a8');
    gradient.addColorStop(0.5, '#ea9a63');
    gradient.addColorStop(1, '#d86d3a');

    ctx.fillStyle = gradient;
    ctx.fillRect(gaugeX, gaugeY, gaugeWidth * session.powerGauge, gaugeHeight);

    ctx.strokeStyle = '#6a4e3c';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(gaugeX, gaugeY, gaugeWidth, gaugeHeight);

    ctx.fillStyle = '#6a4e3c';
    ctx.font = 'bold 18px \"M PLUS Rounded 1c\", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('パワー', gaugeX + gaugeWidth / 2, gaugeY - 10);

    const powerPercent = Math.round(session.powerGauge * 100);
    ctx.fillStyle = '#6a4e3c';
    ctx.font = 'bold 16px \"M PLUS Rounded 1c\", sans-serif';
    ctx.fillText(powerPercent + '%', gaugeX + gaugeWidth / 2, gaugeY + gaugeHeight / 2 + 6);
}

function drawPackageAnimation() {
    if (!session.packageAnim) return;

    const size = 80;

    if (session.packageAnim.phase === 'holding') {
        // タップ中は静止表示
        ctx.save();
        ctx.translate(session.packageAnim.x, session.packageAnim.y);
        ctx.drawImage(packageImage, -size / 2, -size / 2, size, size);
        ctx.restore();
    } else if (session.packageAnim.phase === 'shaking') {
        // 振りかけアニメーション
        session.packageAnim.shakeProgress += 0.06;

        if (session.packageAnim.shakeProgress >= 1) {
            // アニメーション終了
            session.packageAnim = null;
            return;
        }

        // 左に120度傾けてから元に戻る動き
        const progress = session.packageAnim.shakeProgress;
        const maxRotation = -120 * Math.PI / 180; // 120度を左に傾ける

        // 前半(0-0.4): 120度まで傾ける
        // 後半(0.4-1): 元に戻る
        let rotation;
        if (progress < 0.4) {
            rotation = maxRotation * (progress / 0.4);
        } else {
            const returnProgress = (progress - 0.4) / 0.6;
            rotation = maxRotation * (1 - returnProgress);
        }

        session.packageAnim.rotation = rotation;
        session.packageAnim.offsetX = -20 * Math.sin(progress * Math.PI); // 左に少し移動して戻る
        session.packageAnim.offsetY = -15 * Math.sin(progress * Math.PI); // 上に少し移動して戻る

        // 後半から徐々にフェードアウト
        const opacity = progress < 0.6 ? 1 : 1 - ((progress - 0.6) / 0.4);

        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.translate(session.packageAnim.x + session.packageAnim.offsetX, session.packageAnim.y + session.packageAnim.offsetY);
        ctx.rotate(session.packageAnim.rotation);
        ctx.drawImage(packageImage, -size / 2, -size / 2, size, size);
        ctx.restore();
    }
}

function updatePowerGauge() {
    if (!session.isHolding) return;

    session.powerGauge += gaugeSpeed * session.gaugeDirection;

    if (session.powerGauge >= 1) {
        session.powerGauge = 1;
        session.gaugeDirection = -1;
    } else if (session.powerGauge <= 0) {
        session.powerGauge = 0;
        session.gaugeDirection = 1;
    }
}

function animate() {
    if (session.currentStage === 1) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(offscreenCanvas, 0, 0);

        session.activeParticles = session.activeParticles.filter(particle => {
            const stillActive = particle.update();
            if (stillActive) {
                particle.draw(ctx);
            }
            return stillActive;
        });

        updatePowerGauge();
        drawPowerGauge();
        drawPackageAnimation();

        // ステージ切替時の軽いフラッシュ
        if (session.transitionFlashFrames > 0) {
            const alpha = (session.transitionFlashFrames / 25) * 0.6;
            ctx.save();
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
            session.transitionFlashFrames--;
        }
    }

    requestAnimationFrame(animate);
}

// ミッション1のキャンバスイベント
canvas.addEventListener('mousedown', (e) => {
    if (session.currentStage === 1 && !session.isDraggingSlider && !session.isTransitioningStage) {
        session.isHolding = true;
        session.powerGauge = 0;

        const { x, y } = getPointerPosition(e, canvas);
        const displayX = x - 60;  // 画像表示位置（左上）
        const displayY = y - 60;
        session.packageAnim = {
            x: displayX,
            y: displayY,
            sprinkleX: displayX - 10,  // ごましお発射点は画像位置のさらに左上
            sprinkleY: displayY + 20,
            phase: 'holding', // 'holding' or 'shaking'
            shakeProgress: 0,
            rotation: 0,
            offsetX: 0,
            offsetY: 0
        };
    }
});

canvas.addEventListener('mouseup', (e) => {
    if (session.currentStage === 1 && session.isHolding) {
        const { x, y } = getPointerPosition(e, canvas);
        // パッケージアニメーションに保存された発射点を使用
        const fireX = session.packageAnim ? session.packageAnim.sprinkleX : (x - 30);
        const fireY = session.packageAnim ? session.packageAnim.sprinkleY : y;
        sprinkle(fireX, fireY, session.powerGauge);
        session.isHolding = false;

        // 振りかけアニメーションに切り替え
        if (session.packageAnim) {
            session.packageAnim.phase = 'shaking';
            session.packageAnim.shakeProgress = 0;
        }
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (session.currentStage === 1 && session.isHolding && session.packageAnim && session.packageAnim.phase === 'holding') {
        const { x, y } = getPointerPosition(e, canvas);
        const displayX = x - 60;
        const displayY = y - 60;

        session.packageAnim.x = displayX;
        session.packageAnim.y = displayY;
        session.packageAnim.sprinkleX = displayX - 10;
        session.packageAnim.sprinkleY = displayY + 20;
    }
});

canvas.addEventListener('touchstart', (e) => {
    if (session.currentStage === 1 && !session.isTransitioningStage) {
        e.preventDefault();
        session.isHolding = true;
        session.powerGauge = 0;

        // パッケージアニメーションを開始
        const { x, y } = getPointerPosition(e, canvas);
        const displayX = x - 60;  // 画像表示位置（左上）
        const displayY = y - 60;
        session.packageAnim = {
            x: displayX,
            y: displayY,
            sprinkleX: displayX - 10,  // ごましお発射点は画像位置のさらに左上
            sprinkleY: displayY + 20,
            phase: 'holding',
            shakeProgress: 0,
            rotation: 0,
            offsetX: 0,
            offsetY: 0
        };
    }
});

canvas.addEventListener('touchmove', (e) => {
    if (session.currentStage === 1 && session.isHolding && session.packageAnim && session.packageAnim.phase === 'holding') {
        e.preventDefault();
        const { x, y } = getPointerPosition(e, canvas);
        const displayX = x - 60;
        const displayY = y - 60;

        session.packageAnim.x = displayX;
        session.packageAnim.y = displayY;
        session.packageAnim.sprinkleX = displayX - 10;
        session.packageAnim.sprinkleY = displayY + 20;
    }
});

canvas.addEventListener('touchend', (e) => {
    if (session.currentStage === 1 && session.isHolding) {
        e.preventDefault();
        const { x, y } = getPointerPosition(e, canvas);
        // パッケージアニメーションに保存された発射点を使用
        const fireX = session.packageAnim ? session.packageAnim.sprinkleX : (x - 30);
        const fireY = session.packageAnim ? session.packageAnim.sprinkleY : y;
        sprinkle(fireX, fireY, session.powerGauge);
        session.isHolding = false;

        // 振りかけアニメーションに切り替え
        if (session.packageAnim) {
            session.packageAnim.phase = 'shaking';
            session.packageAnim.shakeProgress = 0;
        }
    }
});

// ミッション2: 切り抜き
function getResizeHandlePos() {
    return {
        x: cropMask.x + cropMask.width / 2,
        y: cropMask.y + cropMask.height / 2
    };
}

function drawCropCircle() {
    cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    cropCtx.drawImage(offscreenCanvas, 0, 0);
    cropCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

    const maskX = cropMask.x - cropMask.width / 2;
    const maskY = cropMask.y - cropMask.height / 2;
    const radius = cropMask.width / 2;
    const renderRadius = radius * 1.25; // 見た目上の抜けを広げる

    if (maskLoaded) {
        cropCtx.save();

        // 円形のぼかしグラデーションでオーバーレイをくり抜く（外周は少し暗めに残す）
        cropCtx.globalCompositeOperation = 'destination-out';
        const gradient = cropCtx.createRadialGradient(
            cropMask.x,
            cropMask.y,
            0,
            cropMask.x,
            cropMask.y,
            renderRadius
        );
        // なめらかに透明へ移行する単一グラデーション
        gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
        gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        cropCtx.fillStyle = gradient;
        cropCtx.beginPath();
        cropCtx.arc(cropMask.x, cropMask.y, renderRadius, 0, Math.PI * 2);
        cropCtx.fill();
        cropCtx.globalCompositeOperation = 'source-over';

        // 円形クリップの中だけ表示
        cropCtx.save();
        cropCtx.beginPath();
        cropCtx.arc(cropMask.x, cropMask.y, radius, 0, Math.PI * 2);
        cropCtx.clip();

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = cropMask.width;
        tempCanvas.height = cropMask.height;
        const tempCtx = tempCanvas.getContext('2d');

        // ごましおを描画
        tempCtx.drawImage(offscreenCanvas, maskX, maskY, cropMask.width, cropMask.height, 0, 0, cropMask.width, cropMask.height);

        // オーバーレイ画像を重ねて切り抜き時にもキャラを確認できるようにする
        if (maskNoBgLoaded) {
            tempCtx.drawImage(maskNoBgImage, 0, 0, cropMask.width, cropMask.height);
        }

        cropCtx.drawImage(tempCanvas, maskX, maskY);
        cropCtx.restore();
    }

    // リサイズハンドル
    const handle = getResizeHandlePos();
    cropCtx.fillStyle = '#fff';
    cropCtx.beginPath();
    cropCtx.arc(handle.x, handle.y, 12, 0, Math.PI * 2);
    cropCtx.fill();

    cropCtx.strokeStyle = '#ea7640';
    cropCtx.lineWidth = 3;
    cropCtx.beginPath();
    cropCtx.arc(handle.x, handle.y, 12, 0, Math.PI * 2);
    cropCtx.stroke();

    cropCtx.strokeStyle = '#ea7640';
    cropCtx.lineWidth = 2;
    cropCtx.lineCap = 'round';

    const arrowSize = 6;
    cropCtx.beginPath();
    cropCtx.moveTo(handle.x - arrowSize, handle.y - arrowSize);
    cropCtx.lineTo(handle.x + arrowSize, handle.y + arrowSize);
    cropCtx.stroke();

    cropCtx.beginPath();
    cropCtx.moveTo(handle.x - arrowSize, handle.y - arrowSize);
    cropCtx.lineTo(handle.x - arrowSize + 3, handle.y - arrowSize);
    cropCtx.moveTo(handle.x - arrowSize, handle.y - arrowSize);
    cropCtx.lineTo(handle.x - arrowSize, handle.y - arrowSize + 3);
    cropCtx.stroke();

    cropCtx.beginPath();
    cropCtx.moveTo(handle.x + arrowSize, handle.y + arrowSize);
    cropCtx.lineTo(handle.x + arrowSize - 3, handle.y + arrowSize);
    cropCtx.moveTo(handle.x + arrowSize, handle.y + arrowSize);
    cropCtx.lineTo(handle.x + arrowSize, handle.y + arrowSize - 3);
    cropCtx.stroke();
}

cropCanvas.addEventListener('mousedown', (e) => {
    if (session.currentStage !== 2) return;
    const { x, y } = getPointerPosition(e, cropCanvas);

    const handle = getResizeHandlePos();
    const distToHandle = Math.sqrt((x - handle.x) ** 2 + (y - handle.y) ** 2);

    if (distToHandle < 15) {
        isDraggingResize = true;
    } else {
        const maskX = cropMask.x - cropMask.width / 2;
        const maskY = cropMask.y - cropMask.height / 2;

        if (x >= maskX && x <= maskX + cropMask.width && y >= maskY && y <= maskY + cropMask.height) {
            isDraggingCircle = true;
            dragOffset.x = x - cropMask.x;
            dragOffset.y = y - cropMask.y;
        }
    }
});

cropCanvas.addEventListener('mousemove', (e) => {
    if (session.currentStage !== 2) return;
    const { x, y } = getPointerPosition(e, cropCanvas);

    if (isDraggingResize) {
        const dx = x - cropMask.x;
        const dy = y - cropMask.y;
        const dist = Math.sqrt(dx * dx + dy * dy) * 2;
        const newSize = Math.max(60, Math.min(400, dist));

        cropMask.width = newSize;
        cropMask.height = newSize;
        cropMask.x = Math.max(cropMask.width / 2, Math.min(cropCanvas.width - cropMask.width / 2, cropMask.x));
        cropMask.y = Math.max(cropMask.height / 2, Math.min(cropCanvas.height - cropMask.height / 2, cropMask.y));

        drawCropCircle();
    } else if (isDraggingCircle) {
        cropMask.x = x - dragOffset.x;
        cropMask.y = y - dragOffset.y;
        cropMask.x = Math.max(cropMask.width / 2, Math.min(cropCanvas.width - cropMask.width / 2, cropMask.x));
        cropMask.y = Math.max(cropMask.height / 2, Math.min(cropCanvas.height - cropMask.height / 2, cropMask.y));

        drawCropCircle();
    } else {
        const handle = getResizeHandlePos();
        const distToHandle = Math.sqrt((x - handle.x) ** 2 + (y - handle.y) ** 2);
        cropCanvas.style.cursor = distToHandle < 15 ? 'nwse-resize' : 'crosshair';
    }
});

cropCanvas.addEventListener('mouseup', () => {
    isDraggingCircle = false;
    isDraggingResize = false;
});

cropCanvas.addEventListener('touchstart', (e) => {
    if (session.currentStage !== 2) return;
    e.preventDefault();
    const { x, y } = getPointerPosition(e, cropCanvas);

    const handle = getResizeHandlePos();
    const distToHandle = Math.sqrt((x - handle.x) ** 2 + (y - handle.y) ** 2);

    if (distToHandle < 20) {
        isDraggingResize = true;
    } else {
        const maskX = cropMask.x - cropMask.width / 2;
        const maskY = cropMask.y - cropMask.height / 2;

        if (x >= maskX && x <= maskX + cropMask.width && y >= maskY && y <= maskY + cropMask.height) {
            isDraggingCircle = true;
            dragOffset.x = x - cropMask.x;
            dragOffset.y = y - cropMask.y;
        }
    }
});

cropCanvas.addEventListener('touchmove', (e) => {
    if (session.currentStage !== 2) return;
    e.preventDefault();
    const { x, y } = getPointerPosition(e, cropCanvas);

    if (isDraggingResize) {
        const dx = x - cropMask.x;
        const dy = y - cropMask.y;
        const dist = Math.sqrt(dx * dx + dy * dy) * 2;
        const newSize = Math.max(60, Math.min(400, dist));

        cropMask.width = newSize;
        cropMask.height = newSize;
        cropMask.x = Math.max(cropMask.width / 2, Math.min(cropCanvas.width - cropMask.width / 2, cropMask.x));
        cropMask.y = Math.max(cropMask.height / 2, Math.min(cropCanvas.height - cropMask.height / 2, cropMask.y));

        drawCropCircle();
    } else if (isDraggingCircle) {
        cropMask.x = x - dragOffset.x;
        cropMask.y = y - dragOffset.y;
        cropMask.x = Math.max(cropMask.width / 2, Math.min(cropCanvas.width - cropMask.width / 2, cropMask.x));
        cropMask.y = Math.max(cropMask.height / 2, Math.min(cropCanvas.height - cropMask.height / 2, cropMask.y));

        drawCropCircle();
    }
});

cropCanvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    isDraggingCircle = false;
    isDraggingResize = false;
});

document.getElementById('confirmCropBtn').addEventListener('click', () => {
    switchStage(3);
});

// ミッション3: 保存
function createCroppedImage() {
    if (!maskLoaded || !maskNoBgLoaded) {
        console.log('Mask images not loaded yet');
        return;
    }

    const outputSize = 400;
    previewCanvas.width = outputSize;
    previewCanvas.height = outputSize;

    previewCtx.clearRect(0, 0, outputSize, outputSize);
    // 背景を白で塗りつぶす
    previewCtx.fillStyle = '#ffffff';
    previewCtx.fillRect(0, 0, outputSize, outputSize);

    const maskX = cropMask.x - cropMask.width / 2;
    const maskY = cropMask.y - cropMask.height / 2;
    const scale = outputSize / cropMask.width;

    // ステップ1: 一時キャンバスでごましおを描画
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = outputSize;
    tempCanvas.height = outputSize;
    const tempCtx = tempCanvas.getContext('2d');

    // パーティクルを一時キャンバスに描画
    session.settledParticles.forEach(particle => {
        if (particle.x >= maskX && particle.x <= maskX + cropMask.width &&
            particle.y >= maskY && particle.y <= maskY + cropMask.height) {

            const relX = particle.x - maskX;
            const relY = particle.y - maskY;
            const outputX = relX * scale;
            const outputY = relY * scale;
            const perspectiveScale = 1 / (1 + particle.z * 0.05);
            const size = particle.baseSize * perspectiveScale * scale;

            if (size < 0.5) return;

            tempCtx.save();
            tempCtx.translate(outputX, outputY);
            tempCtx.rotate(particle.rotation);

            if (particle.isBlack) {
                tempCtx.fillStyle = '#000000';
                tempCtx.beginPath();
                tempCtx.ellipse(0, 0, size, size * 0.6, 0, 0, Math.PI * 2);
                tempCtx.fill();
            } else {
                tempCtx.fillStyle = '#ffffff';
                tempCtx.beginPath();
                tempCtx.rect(-size / 2, -size / 2, size, size);
                tempCtx.fill();
            }

            tempCtx.restore();
        }
    });

    // ステップ2: メインキャンバスにごましおを描画
    previewCtx.drawImage(tempCanvas, 0, 0);

    // ステップ3: その上に透過PNG画像（maskImage）を重ねる
    // maskImageはキャラクターの頭の部分のみが透過され、周囲は不透明な画像
    previewCtx.drawImage(maskImage, 0, 0, outputSize, outputSize);

    // プレビュー画像を表示
    const previewImage = document.getElementById('previewImage');
    previewImage.src = previewCanvas.toDataURL('image/png');

    // オーバーレイも重ねて表示
    const overlayPreview = document.getElementById('overlayPreview');
    overlayPreview.src = maskImage.src;

    // 最近の作品として保存（最大3件）
    saveRecentImage(previewImage.src);
}

document.getElementById('downloadBtn').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'gomasio-art.png';
    link.href = previewCanvas.toDataURL('image/png');
    link.click();
});

document.getElementById('restartBtn').addEventListener('click', () => {
    switchStage(1);
});

// マスク定義リスト（順序制御用）
const MASK_LIST = [
    { id: 'magao', name: 'まがお' },
    { id: 'magaoNoago', name: 'まがお（ごまあご）' },
    { id: 'buchigire', name: 'ブチギレ' },
    { id: 'buchigireNoago', name: 'ブチギレ（ごまあご）' }
];

function updateMaskSelection() {
    const currentMask = MASK_LIST.find(m => m.id === session.maskType) || MASK_LIST[0];
    document.getElementById('currentMaskName').textContent = currentMask.name;
    loadMaskImages(session.maskType);

    if (session.currentStage === 2) {
        drawCropCircle();
    }
}

document.getElementById('prevMaskBtn').addEventListener('click', () => {
    const currentIndex = MASK_LIST.findIndex(m => m.id === session.maskType);
    const prevIndex = (currentIndex - 1 + MASK_LIST.length) % MASK_LIST.length;
    session.maskType = MASK_LIST[prevIndex].id;
    updateMaskSelection();
});

document.getElementById('nextMaskBtn').addEventListener('click', () => {
    const currentIndex = MASK_LIST.findIndex(m => m.id === session.maskType);
    const nextIndex = (currentIndex + 1) % MASK_LIST.length;
    session.maskType = MASK_LIST[nextIndex].id;
    updateMaskSelection();
});

// 初期化
updateSliderPosition();
updateMaskSelection(); // 初期表示更新
switchStage(1);
animate();
renderRecentImages();
