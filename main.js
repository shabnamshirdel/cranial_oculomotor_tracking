class TrackerExperiment {
    constructor() {
        // Scene Setup
        this.scene = new THREE.Scene();
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
        this.landmarks = null;
        this.faceGeometry = null;

        // Gaze Tracking State
        // We track the offset of the iris relative to the eye center
        this.calibratedOffset = { x: 0, y: 0 };
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
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(468 * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0x00ff9d,
            size: 2,
            sizeAttenuation: false,
            transparent: true,
            opacity: 0.4 // Lower opacity to emphasize eyes
        });

        this.facePoints = new THREE.Points(geometry, material);
        this.scene.add(this.facePoints);

        // 2. Eye Highlights (New)
        // We will add specific markers for the irises
        const irisGeo = new THREE.CircleGeometry(4, 16);
        const irisMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
        this.leftIrisMesh = new THREE.Mesh(irisGeo, irisMat);
        this.rightIrisMesh = new THREE.Mesh(irisGeo, irisMat);
        this.scene.add(this.leftIrisMesh);
        this.scene.add(this.rightIrisMesh);

        // 3. Gaze Trail (Line)
        const trailGeo = new THREE.BufferGeometry();
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

        // 4. Gaze Cursor (Ring)
        const cursorGeo = new THREE.RingGeometry(8, 10, 32);
        const cursorMat = new THREE.MeshBasicMaterial({ color: 0xff3333, side: THREE.DoubleSide });
        this.cursor = new THREE.Mesh(cursorGeo, cursorMat);
        this.scene.add(this.cursor);
    }

    async init() {
        await this.setupVideo();
        await this.setupMediaPipe();
        this.animate();

        const startBtn = document.getElementById('start-btn');
        startBtn.textContent = "INITIALIZE PUPIL TRACKING";
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
            alert("Camera access required.");
        }
    }

    async setupMediaPipe() {
        if (typeof window.FaceMesh === 'undefined') return;

        this.faceMesh = new window.FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`
        });

        this.faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true, // Crucial for Iris tracking
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
        document.getElementById('status-indicator').textContent = "PUPIL_TRACKING_ACTIVE";
        document.getElementById('status-indicator').style.color = "#00ffff";

        // Update labels to reflect new mode
        document.querySelectorAll('.label')[0].textContent = "IRIS_L_X:";
        document.querySelectorAll('.label')[1].textContent = "IRIS_R_X:";

        this.isRunning = true;
        this.calibrate();
        this.processVideo();
    }

    calibrate() {
        if (this.landmarks) {
            // Calculate current iris offset and set it as "Zero"
            // This assumes the user is looking at the center of the screen during calibration
            const offset = this.calculateIrisOffset(this.landmarks);
            this.calibratedOffset = offset;
            this.trailPoints = [];

            console.log("Calibrated Center Offset:", this.calibratedOffset);
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
        const positions = this.facePoints.geometry.attributes.position.array;
        const width = window.innerWidth;
        const height = window.innerHeight;

        for (let i = 0; i < landmarks.length; i++) {
            const x = (1 - landmarks[i].x) * width - width / 2;
            const y = -(landmarks[i].y * height - height / 2);
            const z = -landmarks[i].z * width;

            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;
        }
        this.facePoints.geometry.attributes.position.needsUpdate = true;

        // Update Iris Markers specifically
        // 468 is Right Iris Center (Image Left), 473 is Left Iris Center (Image Right)
        const rightIris = landmarks[468];
        const leftIris = landmarks[473];

        this.leftIrisMesh.position.set(
            (1 - leftIris.x) * width - width / 2,
            -(leftIris.y * height - height / 2),
            -leftIris.z * width
        );

        this.rightIrisMesh.position.set(
            (1 - rightIris.x) * width - width / 2,
            -(rightIris.y * height - height / 2),
            -rightIris.z * width
        );
    }

    // Helper: Calculate how far the irises are from the center of the eye sockets
    calculateIrisOffset(landmarks) {
        // Right Eye (User's Right) Indices
        // Inner: 33, Outer: 133, Iris: 468
        const rInner = landmarks[33];
        const rOuter = landmarks[133];
        const rIris = landmarks[468];

        // Left Eye (User's Left) Indices
        // Inner: 362, Outer: 263, Iris: 473
        const lInner = landmarks[362];
        const lOuter = landmarks[263];
        const lIris = landmarks[473];

        // Calculate Eye Centers (Socket Centers)
        const rCenter = {
            x: (rInner.x + rOuter.x) / 2,
            y: (rInner.y + rOuter.y) / 2
        };
        const lCenter = {
            x: (lInner.x + lOuter.x) / 2,
            y: (lInner.y + lOuter.y) / 2
        };

        // Calculate Iris Vector (Vector from Socket Center to Iris Center)
        // We average both eyes for stability
        const rVec = { x: rIris.x - rCenter.x, y: rIris.y - rCenter.y };
        const lVec = { x: lIris.x - lCenter.x, y: lIris.y - lCenter.y };

        return {
            x: (rVec.x + lVec.x) / 2,
            y: (rVec.y + lVec.y) / 2
        };
    }

    updateMetrics(landmarks) {
        // 1. Get current Raw Iris Vector
        const currentOffset = this.calculateIrisOffset(landmarks);

        // 2. Display Raw Metrics (Iris Shift)
        document.getElementById('val-yaw').textContent = (currentOffset.x * 1000).toFixed(2); // Reusing labels
        document.getElementById('val-pitch').textContent = (currentOffset.y * 1000).toFixed(2);

        // 3. Calculate Gaze Delta
        // How much has the eye moved relative to calibration?
        // Sensitivity must be HIGH because eyes move very small distances (pixels)
        const SENSITIVITY_X = 60.0;
        const SENSITIVITY_Y = 80.0; // Vertical eye movement is subtler

        const deltaX = (currentOffset.x - this.calibratedOffset.x) * SENSITIVITY_X;
        const deltaY = (currentOffset.y - this.calibratedOffset.y) * SENSITIVITY_Y;

        // 4. Smoothing
        // Eyes are jittery; we need stronger smoothing than head tracking
        // Lerp factor 0.05 = very smooth (slow), 0.2 = twitchy (fast)
        const lerpFactor = 0.08;

        this.smoothGaze.x += (deltaX - this.smoothGaze.x) * lerpFactor;
        this.smoothGaze.y += (deltaY - this.smoothGaze.y) * lerpFactor;

        // Update UI Coordinates
        document.getElementById('val-x').textContent = (-this.smoothGaze.x).toFixed(3);
        document.getElementById('val-y').textContent = this.smoothGaze.y.toFixed(3);

        // Update 3D Cursor
        const cursorX = -this.smoothGaze.x * window.innerWidth; // Mirror X
        const cursorY = -this.smoothGaze.y * window.innerHeight; // Invert Y

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
            if (this.frameCount % 10 === 0) {
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