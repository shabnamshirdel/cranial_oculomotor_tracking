class TrackerExperiment {
    constructor() {
        // Scene Setup
        this.scene = new THREE.Scene();
        // Orthographic camera for 2D UI-like overlay feel
        this.camera = new THREE.OrthographicCamera(
            -window.innerWidth / 2, window.innerWidth / 2,
            window.innerHeight / 2, -window.innerHeight / 2,
            1, 1000
        );
        this.camera.position.z = 100;

        this.renderer = new THREE.WebGLRenderer({
            canvas: document.getElementById('analysisCanvas'),
            alpha: true,
            antialias: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        // State
        this.isRunning = false;
        this.faceMesh = null;
        this.landmarks = null; // Store latest raw data
        this.faceGeometry = null; // THREE.Points for face wireframe

        // Gaze Tracking Data
        this.calibratedCenter = { x: 0.5, y: 0.5 };
        this.currentGaze = { x: 0.5, y: 0.5 };
        this.smoothGaze = { x: 0.5, y: 0.5 };
        this.trailPoints = [];
        this.maxTrailLength = 50;
        this.showTrail = true;

        // Metrics
        this.lastFrameTime = 0;
        this.frameCount = 0;

        // Init
        this.setupSceneObjects();
        this.init();

        // Event Listeners
        window.addEventListener('resize', () => this.handleResize());
        document.getElementById('toggle-trail-btn').addEventListener('click', () => {
            this.showTrail = !this.showTrail;
            this.trailLine.visible = this.showTrail;
        });
        document.getElementById('reset-btn').addEventListener('click', () => this.calibrate());
    }

    setupSceneObjects() {
        // 1. Face Topology (Points)
        // MediaPipe FaceMesh has 468 landmarks
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(468 * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0x00ff9d,
            size: 3,
            sizeAttenuation: false,
            transparent: true,
            opacity: 0.6
        });

        this.facePoints = new THREE.Points(geometry, material);
        this.scene.add(this.facePoints);

        // 2. Gaze Trail (Line)
        const trailGeo = new THREE.BufferGeometry();
        // Initialize with zeros
        const trailPos = new Float32Array(this.maxTrailLength * 3);
        trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));

        const trailMat = new THREE.LineBasicMaterial({
            color: 0x008f58,
            linewidth: 2,
            transparent: true,
            opacity: 0.8
        });

        this.trailLine = new THREE.Line(trailGeo, trailMat);
        this.scene.add(this.trailLine);

        // 3. Gaze Cursor (Ring)
        const cursorGeo = new THREE.RingGeometry(10, 12, 32);
        const cursorMat = new THREE.MeshBasicMaterial({ color: 0xff3333, side: THREE.DoubleSide });
        this.cursor = new THREE.Mesh(cursorGeo, cursorMat);
        this.scene.add(this.cursor);
    }

    async init() {
        await this.setupVideo();
        await this.setupMediaPipe();
        this.animate();

        // UI Ready state
        const startBtn = document.getElementById('start-btn');
        startBtn.textContent = "INITIALIZE TRACKING";
        startBtn.disabled = false;
        startBtn.addEventListener('click', () => this.startExperiment());
    }

    async setupVideo() {
        const video = document.getElementById('videoElement');
        this.video = video;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
            });
            video.srcObject = stream;
            return new Promise(resolve => {
                video.onloadeddata = () => resolve();
            });
        } catch (err) {
            console.error("Camera denied", err);
            alert("Camera access required for experiment.");
        }
    }

    async setupMediaPipe() {
        if (typeof window.FaceMesh === 'undefined') return;

        this.faceMesh = new window.FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`
        });

        this.faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.faceMesh.onResults(results => {
            if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
                this.landmarks = results.multiFaceLandmarks[0];
                this.updateTopology(this.landmarks);
                this.updateMetrics(this.landmarks);
            }
        });
    }

    startExperiment() {
        document.getElementById('calibration-overlay').style.display = 'none';
        document.getElementById('status-indicator').textContent = "TRACKING_ACTIVE";
        document.getElementById('status-indicator').style.color = "#00ff9d";
        this.isRunning = true;
        this.calibrate();
        this.processVideo();
    }

    calibrate() {
        if (this.landmarks) {
            // Set current head position as the "center" / zero point
            const nose = this.landmarks[1];
            this.calibratedCenter = { x: nose.x, y: nose.y };
            this.trailPoints = []; // Clear trail
        }
    }

    async processVideo() {
        if (!this.isRunning) return;
        if (this.video && this.video.readyState >= 2) {
            await this.faceMesh.send({ image: this.video });
        }
        requestAnimationFrame(() => this.processVideo());
    }

    updateTopology(landmarks) {
        // Update the THREE.Points mesh to match face landmarks
        const positions = this.facePoints.geometry.attributes.position.array;

        const width = window.innerWidth;
        const height = window.innerHeight;

        for (let i = 0; i < landmarks.length; i++) {
            // Map 0-1 coords to screen space centered at 0,0
            // x is mirrored (1 - x)
            const x = (1 - landmarks[i].x) * width - width / 2;
            const y = -(landmarks[i].y * height - height / 2); // Invert Y
            const z = -landmarks[i].z * width; // Approximate depth scaling

            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;
        }

        this.facePoints.geometry.attributes.position.needsUpdate = true;
    }

    updateMetrics(landmarks) {
        // 1. Calculate Head Orientation (Approximate)
        // Nose tip: 1, Left Ear: 234, Right Ear: 454
        const nose = landmarks[1];
        const leftEar = landmarks[234];
        const rightEar = landmarks[454];

        // Yaw: Difference in Z between ears (simplified) or X relative to nose
        // A simple Yaw approx: deviation of nose X from midpoint of ears X
        const earMidX = (leftEar.x + rightEar.x) / 2;
        const yawRaw = (nose.x - earMidX) * 100; // Scaling factor

        // Pitch: Nose Y relative to ear Y
        const earMidY = (leftEar.y + rightEar.y) / 2;
        const pitchRaw = (nose.y - earMidY) * 100;

        // Update UI
        document.getElementById('val-yaw').textContent = yawRaw.toFixed(2) + "°";
        document.getElementById('val-pitch').textContent = pitchRaw.toFixed(2) + "°";

        // 2. Calculate Gaze/Pointer
        // Logic: Movement of nose relative to calibrated center
        // Amplified to cover screen
        const sensitivity = 2.5;
        const rawX = (nose.x - this.calibratedCenter.x) * sensitivity;
        const rawY = (nose.y - this.calibratedCenter.y) * sensitivity;

        // Smoothing
        this.smoothGaze.x += (rawX - this.smoothGaze.x) * 0.1;
        this.smoothGaze.y += (rawY - this.smoothGaze.y) * 0.1;

        // Update UI Coordinates
        document.getElementById('val-x').textContent = (-this.smoothGaze.x).toFixed(3);
        document.getElementById('val-y').textContent = this.smoothGaze.y.toFixed(3);

        // Update 3D Cursor
        const cursorX = -this.smoothGaze.x * window.innerWidth; // Mirror
        const cursorY = -this.smoothGaze.y * window.innerHeight;

        this.cursor.position.set(cursorX, cursorY, 10);

        // Update Trail
        if (this.showTrail) {
            this.updateTrail(cursorX, cursorY);
        }
    }

    updateTrail(x, y) {
        this.trailPoints.push({ x, y, z: 0 });
        if (this.trailPoints.length > this.maxTrailLength) {
            this.trailPoints.shift();
        }

        const positions = this.trailLine.geometry.attributes.position.array;

        // Reset array
        for (let i = 0; i < positions.length; i++) positions[i] = 0;

        // Fill active points
        for (let i = 0; i < this.trailPoints.length; i++) {
            positions[i * 3] = this.trailPoints[i].x;
            positions[i * 3 + 1] = this.trailPoints[i].y;
            positions[i * 3 + 2] = this.trailPoints[i].z;
        }
        this.trailLine.geometry.attributes.position.needsUpdate = true;
    }

    handleResize() {
        this.camera.left = -window.innerWidth / 2;
        this.camera.right = window.innerWidth / 2;
        this.camera.top = window.innerHeight / 2;
        this.camera.bottom = -window.innerHeight / 2;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const now = performance.now();
        if (this.lastFrameTime) {
            const fps = Math.round(1000 / (now - this.lastFrameTime));
            if (this.frameCount % 10 === 0) { // Update FPS only occasionally
                document.getElementById('val-fps').textContent = fps;
            }
        }
        this.lastFrameTime = now;
        this.frameCount++;

        this.renderer.render(this.scene, this.camera);
    }
}

// Start
window.addEventListener('load', () => new TrackerExperiment());