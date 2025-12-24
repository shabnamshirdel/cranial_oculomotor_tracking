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
            opacity: 0.4
        });

        this.facePoints = new THREE.Points(geometry, material);
        this.scene.add(this.facePoints);

        // 2. Eye Highlights
        const irisGeo = new THREE.CircleGeometry(4, 16);
        const irisMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
        this.leftIrisMesh = new THREE.Mesh(irisGeo, irisMat);
        this.rightIrisMesh = new THREE.Mesh(irisGeo, irisMat);
        this.scene.add(this.leftIrisMesh);
        this.scene.add(this.rightIrisMesh);

        // 3. Gaze Trail
        const trailGeo = new THREE.BufferGeometry();
        const trailPos = new Float32Array(this.maxTrailLength * 3);
        trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));

        const trailMat = new THREE.LineBasicMaterial({
            color: 0xe69138,
            linewidth: 2,
            transparent: true,
            opacity: 0.8
        });

        this.trailLine = new THREE.Line(trailGeo, trailMat);
        this.scene.add(this.trailLine);

        // 4. Gaze Cursor
        const cursorGeo = new THREE.RingGeometry(8, 10, 32);
        const cursorMat = new THREE.MeshBasicMaterial({ color: 0xff3333, side: THREE.DoubleSide });
        this.cursor = new THREE.Mesh(cursorGeo, cursorMat);
        this.scene.add(this.cursor);
    }

    async init() {
        await this.setupVideo();
        await this.setupMediaPipe();

        // AUTO-START: Immediately start the experiment instead of waiting for button click
        this.animate();
        this.startExperiment();
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
        // Removed code that hid the overlay (since we removed it from HTML)
        document.getElementById('status-indicator').textContent = "PUPIL_TRACKING_ACTIVE";
        document.getElementById('status-indicator').style.color = "#00ffff";

        // FIX: Removed code that renamed .label[0] and .label[1]
        // This ensures the Status and Head Yaw labels remain visible and correct

        this.isRunning = true;
        this.calibrate();
        this.processVideo();
    }

    calibrate() {
        if (this.landmarks) {
            const offsetData = this.calculateIrisOffset(this.landmarks);
            // Use the average offset for calibration
            this.calibratedOffset = offsetData.avg;
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

    calculateIrisOffset(landmarks) {
        // Right Eye Indices
        const rInner = landmarks[33];
        const rOuter = landmarks[133];
        const rIris = landmarks[468];

        // Left Eye Indices
        const lInner = landmarks[362];
        const lOuter = landmarks[263];
        const lIris = landmarks[473];

        // Eye Centers
        const rCenter = {
            x: (rInner.x + rOuter.x) / 2,
            y: (rInner.y + rOuter.y) / 2
        };
        const lCenter = {
            x: (lInner.x + lOuter.x) / 2,
            y: (lInner.y + lOuter.y) / 2
        };

        // Iris Vectors
        const rVec = { x: rIris.x - rCenter.x, y: rIris.y - rCenter.y };
        const lVec = { x: lIris.x - lCenter.x, y: lIris.y - lCenter.y };

        // Return individual vectors AND the average
        return {
            left: lVec,
            right: rVec,
            avg: {
                x: (rVec.x + lVec.x) / 2,
                y: (rVec.y + lVec.y) / 2
            }
        };
    }

    updateMetrics(landmarks) {

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
        document.getElementById('val-yaw').textContent = yawRaw.toFixed(2);
        document.getElementById('val-pitch').textContent = pitchRaw.toFixed(2);


        // 1. Get current Offset Data
        const offsetData = this.calculateIrisOffset(landmarks);
        const currentAvg = offsetData.avg;

        // 2. Display Raw Metrics (Separate Left/Right)
        // We multiply by 1000 for readability
        document.getElementById('val-iris-l').textContent = (offsetData.left.x * 1000).toFixed(2);
        document.getElementById('val-iris-r').textContent = (offsetData.right.x * 1000).toFixed(2);

        // Note: Raw Head Yaw/Pitch are not calculated in this script, 
        // so we leave them as 0.00 in the HTML to avoid showing incorrect data.

        // 3. Calculate Gaze Delta
        const SENSITIVITY_X = 60.0;
        const SENSITIVITY_Y = 80.0;

        const deltaX = (currentAvg.x - this.calibratedOffset.x) * SENSITIVITY_X;
        const deltaY = (currentAvg.y - this.calibratedOffset.y) * SENSITIVITY_Y;

        // 4. Smoothing
        const lerpFactor = 0.08;

        this.smoothGaze.x += (deltaX - this.smoothGaze.x) * lerpFactor;
        this.smoothGaze.y += (deltaY - this.smoothGaze.y) * lerpFactor;

        // Update UI Coordinates
        document.getElementById('val-x').textContent = (-this.smoothGaze.x).toFixed(3);
        document.getElementById('val-y').textContent = this.smoothGaze.y.toFixed(3);

        // Update 3D Cursor
        const cursorX = -this.smoothGaze.x * window.innerWidth;
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

        for (let i = 0; i < positions.length; i++) positions[i] = 0;

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