// JavaScript for GPX Analyzer & Editor will go here
console.log("script.js loaded");

// Global Variables
let selectedRange = { startDistance: null, endDistance: null, startIndex: -1, endIndex: -1 };
let map;
let altitudeChart;
let speedChart;
let gpxData = { points: [], totalDistance: 0 };
let trackHighlightMarker;
let rangeHighlightPolyline = null;
let highlightDebounceTimeout; // For debouncing highlight updates

const gpxFileInput = document.getElementById('gpxFile');
const gpxDataDisplay = document.getElementById('gpxData');

gpxFileInput.addEventListener('change', function(event) {
    const file = event.target.files[0];

    if (file) {
        gpxDataDisplay.innerHTML = `<p>Processing file: ${file.name}...</p>`;
        const reader = new FileReader();

        reader.onload = function(e) {
            const fileContent = e.target.result;
            console.log("File content loaded, length:", fileContent.length);

            try {
                const gpx = new gpxParser();
                gpx.parse(fileContent);

                // Clear previous map and charts
                if (map) {
                    map.remove();
                    map = null; // Ensure it's reset for next file
                }
                if (altitudeChart) {
                    altitudeChart.destroy();
                    altitudeChart = null;
                }
                if (speedChart) {
                    speedChart.destroy();
                    speedChart = null;
                }
                if (trackHighlightMarker) {
                    trackHighlightMarker.remove();
                    trackHighlightMarker = null;
                }


                gpxData = { points: [], totalDistance: 0 }; // Reset gpxData

                // ---> Start of new section to replace existing point processing <---
                if (!gpx.tracks.length || !gpx.tracks[0].points || !gpx.tracks[0].points.length) {
                    gpxDataDisplay.innerHTML = '<p>No track data found in this GPX file.</p>';
                    if (map) { map.remove(); map = null; }
                    if (altitudeChart) { altitudeChart.destroy(); altitudeChart = null; }
                    if (speedChart) { speedChart.destroy(); speedChart = null; }
                    return;
                }
                gpxDataDisplay.innerHTML = ''; // Clear display for map/charts

                gpxData.points = []; // Initialize points array
                let totalDistance = 0;
                const rawPoints = gpx.tracks[0].points;

                for (let i = 0; i < rawPoints.length; i++) {
                    const currentRawPoint = rawPoints[i];
                    let distanceFromPrevious = 0;
                    let currentRawSpeed = 0; // Store as raw speed

                    if (i > 0) {
                        const prevRawPoint = rawPoints[i-1];
                        const lat1 = parseFloat(prevRawPoint.lat);
                        const lon1 = parseFloat(prevRawPoint.lon);
                        const lat2 = parseFloat(currentRawPoint.lat);
                        const lon2 = parseFloat(currentRawPoint.lon);

                        if (!isNaN(lat1) && !isNaN(lon1) && !isNaN(lat2) && !isNaN(lon2)) {
                             distanceFromPrevious = calculateDistance(lat1, lon1, lat2, lon2);
                        }

                        const currentTime = new Date(currentRawPoint.time).getTime();
                        const prevTime = new Date(prevRawPoint.time).getTime();

                        if (!isNaN(currentTime) && !isNaN(prevTime)) {
                            const timeDiff = (currentTime - prevTime) / 1000; // seconds
                            if (timeDiff > 0) {
                                currentRawSpeed = (distanceFromPrevious / timeDiff) * 3.6; // m/s to km/h
                            }
                        }
                    }
                    totalDistance += distanceFromPrevious;

                    gpxData.points.push({
                        lat: parseFloat(currentRawPoint.lat),
                        lon: parseFloat(currentRawPoint.lon),
                        alt: currentRawPoint.ele !== undefined ? parseFloat(currentRawPoint.ele) : null,
                        time: new Date(currentRawPoint.time), // Keep as Date object
                        distanceFromStart: totalDistance,
                        rawSpeed: currentRawSpeed, // Store raw speed
                        speed: 0 // Placeholder for smoothed speed
                    });
                }
                gpxData.totalDistance = totalDistance;

                // Second pass: Calculate smoothed speed (20-second floating average)
                const timeWindowSeconds = 20;
                for (let i = 0; i < gpxData.points.length; i++) {
                    const currentPoint = gpxData.points[i];
                    const currentTimeMs = currentPoint.time.getTime();
                    let sumSpeeds = 0;
                    let countSpeeds = 0;

                    // Look backwards for points within the time window
                    for (let j = i; j >= 0; j--) {
                        const pastPoint = gpxData.points[j];
                        const pastTimeMs = pastPoint.time.getTime();

                        if ((currentTimeMs - pastTimeMs) / 1000 <= timeWindowSeconds) {
                            if (pastPoint.rawSpeed !== null && isFinite(pastPoint.rawSpeed)) {
                                sumSpeeds += pastPoint.rawSpeed;
                                countSpeeds++;
                            }
                        } else {
                            break; // Points are too old, stop searching
                        }
                    }
                    gpxData.points[i].speed = (countSpeeds > 0) ? (sumSpeeds / countSpeeds) : currentPoint.rawSpeed; // Use raw if no window
                }
                // ---> End of new section <---

                // Call functions to initialize map and charts
                initMap(gpxData);
                createAltitudeChart(gpxData);
                createSpeedChart(gpxData);
                calculateAndDisplayStats(gpxData); // Display stats after processing

            } catch (error) {
                console.error("Error parsing GPX file:", error);
                gpxDataDisplay.innerHTML = '<p class="error-message">Error parsing GPX file. Make sure it is a valid GPX.</p>';
            }
        };

        reader.onerror = function(e) {
            console.error("FileReader error:", e);
            gpxDataDisplay.innerHTML = '<p class="error-message">Error reading file.</p>';
        };

        reader.readAsText(file);
    } else {
        gpxDataDisplay.innerHTML = '<p>No file selected. Upload a GPX file to see its data here.</p>';
    }
});

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c * 1000; // Distance in meters
    return distance;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

function formatDuration(totalSeconds) {
    if (isNaN(totalSeconds) || totalSeconds < 0) return "N/A";
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDistanceLabel(distanceKm) {
    if (distanceKm >= 100) {
        return Math.round(distanceKm) + 'km';
    } else {
        // Use toFixed(1) for one decimal place, then parseFloat to remove trailing .0 if any
        let formatted = parseFloat(distanceKm.toFixed(1));
        // Ensure that numbers like 1.0 are displayed as "1km" not "1.0km" if that's desired,
        // or always show one decimal place if < 100km.
        // The user request "1.2345km should be 1.2km" implies toFixed(1) is good.
        // "112.3452km should be 112km" is Math.round().
        return formatted + 'km';
    }
}

// Placeholder functions
function initMap(gpxData) { // Renamed parameter to match usage
    console.log("Initializing map with data:", gpxData);
    if (!gpxData || !gpxData.points || gpxData.points.length === 0) {
        console.log("No points to display on map.");
        return;
    }

    const mapElement = document.getElementById('map');
    if (!mapElement) {
        console.error("Map element not found!");
        return;
    }

    // Initialize map centered on the first point
    map = L.map('map').setView([gpxData.points[0].lat, gpxData.points[0].lon], 13);

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Create and add polyline for the track
    const latLngs = gpxData.points.map(p => [p.lat, p.lon]);
    // Dynamically set polyline color from CSS variable
    const polylineColor = getComputedStyle(document.documentElement).getPropertyValue('--gpx-data-strong-color').trim() || 'blue'; // Fallback to blue
    L.polyline(latLngs, { color: polylineColor }).addTo(map);

    // Fit map bounds to the track
    map.fitBounds(latLngs);

    // Initialize highlight marker (initially at the first point)
    // Ensure trackHighlightMarker is declared globally
    if (trackHighlightMarker) { // Remove previous marker if any
        trackHighlightMarker.remove();
    }
    trackHighlightMarker = L.marker([gpxData.points[0].lat, gpxData.points[0].lon], { draggable: false }).addTo(map);
    // To make it less obtrusive initially, you might set its opacity to 0 or use a L.circleMarker
    // For now, a standard marker is fine. We can refine its appearance later.

    // Map mousemove listener to find closest point and update highlight
    map.on('mousemove', function(e) {
        if (!gpxData || !gpxData.points || gpxData.points.length === 0) return;

        let closestPointIndex = -1;
        let minDistance = Infinity;

        gpxData.points.forEach((point, index) => {
            const pointLatLng = L.latLng(point.lat, point.lon); // Create LatLng object for distance calculation
            const distance = e.latlng.distanceTo(pointLatLng); // Use Leaflet's distanceTo
            if (distance < minDistance) {
                minDistance = distance;
                closestPointIndex = index;
            }
        });

        if (closestPointIndex !== -1) {
            // console.log('Closest point index on map hover:', closestPointIndex); // For debugging
            updateHighlight(closestPointIndex);
        }
    });
}

function createAltitudeChart(gpxData) { // Renamed parameter
    console.log("Creating altitude chart with data:", gpxData);
    if (!gpxData || !gpxData.points || gpxData.points.length === 0) {
        console.log("No points for altitude chart.");
        return;
    }
    const ctx = document.getElementById('altitudeChart').getContext('2d');
    if (!ctx) {
        console.error("Altitude chart canvas context not found!");
        return;
    }

    const labels = gpxData.points.map(p => formatDistanceLabel(p.distanceFromStart / 1000));
    const altitudeData = gpxData.points.map(p => p.alt !== null ? p.alt.toFixed(2) : null);

    if (altitudeChart) {
        altitudeChart.destroy();
    }

    const currentTheme = docElement.getAttribute('data-theme');
    let gridColor, labelColor, datasetBorderColorAltitude;

    if (currentTheme === 'dark') {
        gridColor = 'rgba(225, 229, 234, 0.15)';
        labelColor = '#e1e5ea';
        datasetBorderColorAltitude = '#e74c3c';
    } else { // Light mode or any other theme (system preference resolved by applyTheme)
        gridColor = 'rgba(44, 62, 80, 0.1)';
        labelColor = '#2c3e50';
        datasetBorderColorAltitude = '#e74c3c';
    }

    altitudeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Altitude (m)',
                data: altitudeData,
                borderColor: datasetBorderColorAltitude,
                tension: 0.1,
                pointRadius: 0,
                pointHitRadius: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Distance (km)',
                        color: labelColor
                    },
                    ticks: { color: labelColor },
                    grid: { color: gridColor }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Altitude (m)',
                        color: labelColor
                    },
                    ticks: { color: labelColor },
                    grid: { color: gridColor }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: labelColor
                    }
                },
                zoom: {
                    pan: {
                        enabled: false, // Panning can be confusing with selection
                    },
                    zoom: {
                        drag: {
                            enabled: true,
                            backgroundColor: 'rgba(100,150,255,0.3)', // Example color
                            borderColor: 'rgba(100,150,255,0.7)',
                            borderWidth: 1,
                            mode: 'x',
                            onZoomComplete: function({chart}) {
                                console.log('[ALTITUDE CHART] onZoomComplete triggered.');
                                const xAxis = chart.scales.x;
                                console.log('[ALTITUDE CHART] Raw xAxis min:', xAxis.min, 'max:', xAxis.max, typeof xAxis.min, typeof xAxis.max); // Detailed log

                                // Ensure these are numbers, else default to null or handle error
                                selectedRange.startDistance = (typeof xAxis.min === 'number') ? xAxis.min : null;
                                selectedRange.endDistance = (typeof xAxis.max === 'number') ? xAxis.max : null;

                                if (selectedRange.startDistance === null || selectedRange.endDistance === null) {
                                    console.error('[ALTITUDE CHART] Failed to get valid numeric start/end distances from chart scale.');
                                    // Potentially reset or prevent further action if critical
                                    // For now, updateStatsForRange will handle null distances by using full range
                                }

                                console.log('[ALTITUDE CHART] selectedRange.startDistance:', selectedRange.startDistance, 'selectedRange.endDistance:', selectedRange.endDistance);

                                if (speedChart && (speedChart.scales.x.min !== selectedRange.startDistance || speedChart.scales.x.max !== selectedRange.endDistance)) {
                                    console.log('[ALTITUDE CHART] Attempting to sync Speed Chart zoom.');
                                    if (selectedRange.startDistance !== null && selectedRange.endDistance !== null) {
                                        speedChart.zoomScale('x', {min: selectedRange.startDistance, max: selectedRange.endDistance}, 'none');
                                        speedChart.update('none');
                                    } else {
                                        console.log('[ALTITUDE CHART] Skipping sync for speed chart due to null distances.');
                                    }
                                }
                                console.log('[ALTITUDE CHART] Calling updateStatsForRange.');
                                updateStatsForRange();
                            }
                        },
                        mode: 'x', // Zoom only on x-axis
                    }
                }
                // annotation: { annotations: {} } // Keep if you plan to use it later
            },
            interaction: {
                mode: 'index',
                intersect: false,
            },
            onHover: (event, chartElements) => {
                if (chartElements.length > 0) {
                    const dataIndex = chartElements[0].index;
                    // console.log('Altitude chart hover, index:', dataIndex);
                    updateHighlight(dataIndex);
                }
            }
            // plugins: { // Add initial empty annotation config
            //     annotation: {
            //         annotations: {}
            //     }
            // }
        }
    });

    ctx.canvas.ondblclick = () => {
        console.log('[ALTITUDE CHART] Double-click: Resetting zoom.');
        altitudeChart.resetZoom('default'); // Added 'default' for consistency
        selectedRange = { startDistance: null, endDistance: null, startIndex: -1, endIndex: -1 };
        console.log('[ALTITUDE CHART] selectedRange reset.');
        if (speedChart) {
            console.log('[ALTITUDE CHART] Attempting to reset Speed Chart zoom.');
            speedChart.resetZoom('none'); // Use 'none'
            speedChart.update('none');
        }
        console.log('[ALTITUDE CHART] Calling updateStatsForRange after reset.');
        updateStatsForRange();
    };
}

function createSpeedChart(gpxData) { // Renamed parameter
    console.log("Creating speed chart with data:", gpxData);
    if (!gpxData || !gpxData.points || gpxData.points.length === 0) {
        console.log("No points for speed chart.");
        return;
    }
    const ctx = document.getElementById('speedChart').getContext('2d');
    if (!ctx) {
        console.error("Speed chart canvas context not found!");
        return;
    }

    const labels = gpxData.points.map(p => formatDistanceLabel(p.distanceFromStart / 1000));
    const speedData = gpxData.points.map(p => (p.speed !== null && isFinite(p.speed)) ? p.speed.toFixed(2) : null);

    if (speedChart) {
        speedChart.destroy();
    }

    const currentTheme = docElement.getAttribute('data-theme');
    let gridColor, labelColor, datasetBorderColorSpeed;

    if (currentTheme === 'dark') {
        gridColor = 'rgba(225, 229, 234, 0.15)';
        labelColor = '#e1e5ea';
        datasetBorderColorSpeed = '#3498db';
    } else { // Light mode or any other theme (system preference resolved by applyTheme)
        gridColor = 'rgba(44, 62, 80, 0.1)';
        labelColor = '#2c3e50';
        datasetBorderColorSpeed = '#3498db';
    }

    speedChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Smoothed Speed (km/h, 20s avg)', // Updated label
                data: speedData,
                borderColor: datasetBorderColorSpeed,
                tension: 0.1,
                pointRadius: 0,
                pointHitRadius: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Distance (km)',
                        color: labelColor
                    },
                    ticks: { color: labelColor },
                    grid: { color: gridColor }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Speed (km/h)',
                        color: labelColor
                    },
                    ticks: { color: labelColor },
                    grid: { color: gridColor }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: labelColor
                    }
                },
                zoom: {
                    pan: {
                        enabled: false,
                    },
                    zoom: {
                        drag: {
                            enabled: true,
                            backgroundColor: 'rgba(100,150,255,0.3)',
                            borderColor: 'rgba(100,150,255,0.7)',
                            borderWidth: 1,
                            mode: 'x',
                            onZoomComplete: function({chart}) {
                                console.log('[SPEED CHART] onZoomComplete triggered.');
                                const xAxis = chart.scales.x;
                                console.log('[SPEED CHART] Raw xAxis min:', xAxis.min, 'max:', xAxis.max, typeof xAxis.min, typeof xAxis.max); // Detailed log

                                // Ensure these are numbers, else default to null or handle error
                                selectedRange.startDistance = (typeof xAxis.min === 'number') ? xAxis.min : null;
                                selectedRange.endDistance = (typeof xAxis.max === 'number') ? xAxis.max : null;

                                if (selectedRange.startDistance === null || selectedRange.endDistance === null) {
                                    console.error('[SPEED CHART] Failed to get valid numeric start/end distances from chart scale.');
                                }

                                console.log('[SPEED CHART] selectedRange.startDistance:', selectedRange.startDistance, 'selectedRange.endDistance:', selectedRange.endDistance);

                                if (altitudeChart && (altitudeChart.scales.x.min !== selectedRange.startDistance || altitudeChart.scales.x.max !== selectedRange.endDistance)) {
                                    console.log('[SPEED CHART] Attempting to sync Altitude Chart zoom.');
                                     if (selectedRange.startDistance !== null && selectedRange.endDistance !== null) {
                                        altitudeChart.zoomScale('x', {min: selectedRange.startDistance, max: selectedRange.endDistance}, 'none');
                                        altitudeChart.update('none');
                                    } else {
                                        console.log('[SPEED CHART] Skipping sync for altitude chart due to null distances.');
                                    }
                                }
                                console.log('[SPEED CHART] Calling updateStatsForRange.');
                                updateStatsForRange();
                            }
                        },
                        mode: 'x',
                    }
                }
                // annotation: { annotations: {} } // Keep if you plan to use it later
            },
            interaction: {
                mode: 'index',
                intersect: false,
            },
            onHover: (event, chartElements) => {
                if (chartElements.length > 0) {
                    const dataIndex = chartElements[0].index;
                    // console.log('Speed chart hover, index:', dataIndex);
                    updateHighlight(dataIndex);
                }
            }
            // plugins: { // Add initial empty annotation config
            //     annotation: {
            //         annotations: {}
            //     }
            // }
        }
    });

    ctx.canvas.ondblclick = () => {
        console.log('[SPEED CHART] Double-click: Resetting zoom.');
        speedChart.resetZoom('default'); // Added 'default' for consistency
        selectedRange = { startDistance: null, endDistance: null, startIndex: -1, endIndex: -1 };
        console.log('[SPEED CHART] selectedRange reset.');
        if (altitudeChart) {
            console.log('[SPEED CHART] Attempting to reset Altitude Chart zoom.');
            altitudeChart.resetZoom('none'); // Use 'none'
            altitudeChart.update('none');
        }
        console.log('[SPEED CHART] Calling updateStatsForRange after reset.');
        updateStatsForRange();
    };
}

function updateHighlight(index) {
    // Debounce logic
    clearTimeout(highlightDebounceTimeout);
    highlightDebounceTimeout = setTimeout(() => {
        if (!gpxData || !gpxData.points || index < 0 || index >= gpxData.points.length || !gpxData.points[index]) {
            return;
        }
        const point = gpxData.points[index];

        // Map Highlight for single point (only if no range is selected)
        if (map && trackHighlightMarker) {
            if (rangeHighlightPolyline && map.hasLayer(rangeHighlightPolyline)) {
                // A range is selected and visible, hide the single point marker
                if (map.hasLayer(trackHighlightMarker)) {
                    map.removeLayer(trackHighlightMarker);
                }
            } else {
                // No range selected, or range highlight is not on map; show/update single point marker
                trackHighlightMarker.setLatLng([point.lat, point.lon]);
                if (!map.hasLayer(trackHighlightMarker)) {
                    trackHighlightMarker.addTo(map);
                }
            }
        }

        // Altitude Chart Highlight
        if (altitudeChart) {
            const isZoomed = altitudeChart.scales.x.min !== undefined && altitudeChart.scales.x.max !== undefined &&
                             gpxData.points.length > 0 && // ensure points exist before accessing them
                             (altitudeChart.scales.x.min !== gpxData.points[0].distanceFromStart ||
                              altitudeChart.scales.x.max !== gpxData.points[gpxData.points.length - 1].distanceFromStart);

            let currentIndexIsVisible = true;
            if (isZoomed) {
                if (point.distanceFromStart < altitudeChart.scales.x.min || point.distanceFromStart > altitudeChart.scales.x.max) {
                    currentIndexIsVisible = false;
                }
            }

            if (currentIndexIsVisible) {
                if (!altitudeChart.getActiveElements() || altitudeChart.getActiveElements().length === 0 || altitudeChart.getActiveElements()[0].index !== index) {
                    altitudeChart.setActiveElements([{ datasetIndex: 0, index: index }], { x:0, y:0 });
                    altitudeChart.update('none');
                }
            } else {
                 altitudeChart.setActiveElements([], {x:0,y:0});
                 altitudeChart.update('none');
            }
        }

        // Speed Chart Highlight (similar logic for visibility in zoom)
        if (speedChart) {
            const isZoomed = speedChart.scales.x.min !== undefined && speedChart.scales.x.max !== undefined &&
                             gpxData.points.length > 0 && // ensure points exist
                             (speedChart.scales.x.min !== gpxData.points[0].distanceFromStart ||
                              speedChart.scales.x.max !== gpxData.points[gpxData.points.length - 1].distanceFromStart);

            let currentIndexIsVisible = true;
            if (isZoomed) {
                 if (point.distanceFromStart < speedChart.scales.x.min || point.distanceFromStart > speedChart.scales.x.max) {
                    currentIndexIsVisible = false;
                }
            }

            if (currentIndexIsVisible) {
                if (!speedChart.getActiveElements() || speedChart.getActiveElements().length === 0 || speedChart.getActiveElements()[0].index !== index) {
                    speedChart.setActiveElements([{ datasetIndex: 0, index: index }], { x:0, y:0 });
                    speedChart.update('none');
                }
            } else {
                speedChart.setActiveElements([], {x:0,y:0});
                speedChart.update('none');
            }
        }
    }, 10);
}

function updateMapHighlightForRange() {
    console.log('[updateMapHighlightForRange] Called. startIndex:', selectedRange.startIndex, 'endIndex:', selectedRange.endIndex);
    if (!map) return; // Make sure map is initialized

    // Remove existing highlight polyline if any
    if (rangeHighlightPolyline) {
        console.log('[updateMapHighlightForRange] Removing existing rangeHighlightPolyline.');
        map.removeLayer(rangeHighlightPolyline);
        rangeHighlightPolyline = null;
    }

    // Check if a valid range is selected
    if (selectedRange && selectedRange.startIndex !== -1 && selectedRange.endIndex !== -1 && selectedRange.startIndex < selectedRange.endIndex) {
        const pointsToHighlight = gpxData.points.slice(selectedRange.startIndex, selectedRange.endIndex + 1);

        const latLngs = pointsToHighlight
            .filter(p => typeof p.lat === 'number' && typeof p.lon === 'number') // Ensure lat/lon are numbers
            .map(p => [p.lat, p.lon]);

        if (pointsToHighlight.length > 0 && latLngs.length !== pointsToHighlight.length) {
            console.warn('[updateMapHighlightForRange] Some points were filtered out due to missing lat/lon for polyline.');
        }

        if (latLngs.length > 1) {
            console.log('[updateMapHighlightForRange] Creating highlight. Points count:', latLngs.length); // Log based on actual points to be used

            // Get highlight color from CSS variable or fallback
            const highlightColor = getComputedStyle(document.documentElement).getPropertyValue('--selected-range-color').trim() || 'red'; // Example fallback

            rangeHighlightPolyline = L.polyline(latLngs, {
                color: highlightColor,
                weight: 5, // Make it thicker than the main track
                opacity: 0.75
            }).addTo(map);
            console.log('[updateMapHighlightForRange] Adding new rangeHighlightPolyline to map.');
        }
    }
}

function updateStatsForRange() {
    console.log('[updateStatsForRange] Called. Current selectedRange (distances):', selectedRange.startDistance, selectedRange.endDistance);

    let validIndicesFound = false;
    if (selectedRange.startDistance !== null && selectedRange.endDistance !== null && gpxData && gpxData.points && gpxData.points.length > 0) {
        selectedRange.startIndex = findClosestPointIndexByDistance(selectedRange.startDistance);
        selectedRange.endIndex = findClosestPointIndexByDistance(selectedRange.endDistance);

        if (selectedRange.startIndex === -1 || selectedRange.endIndex === -1) {
            console.error('[updateStatsForRange] Failed to find valid start/end indices from distances. Defaulting to full range.');
            selectedRange.startIndex = -1;
            selectedRange.endIndex = -1;
        } else {
            validIndicesFound = true;
            if (selectedRange.startIndex > selectedRange.endIndex) {
                console.log('[updateStatsForRange] Swapping startIndex and endIndex because start > end.');
                [selectedRange.startIndex, selectedRange.endIndex] = [selectedRange.endIndex, selectedRange.startIndex];
            }
        }
    } else {
        console.log('[updateStatsForRange] start/end distances are null or no points, setting indices to -1.');
        selectedRange.startIndex = -1;
        selectedRange.endIndex = -1;
    }
    console.log('[updateStatsForRange] Converted to indices:', selectedRange.startIndex, 'to', selectedRange.endIndex, '(Valid indices found: ' + validIndicesFound + ')');

    console.log('[updateStatsForRange] Calling calculateAndDisplayStats.');
    calculateAndDisplayStats(gpxData, selectedRange.startIndex, selectedRange.endIndex);

    console.log('[updateStatsForRange] Calling updateMapHighlightForRange.');
    updateMapHighlightForRange();
}

function findClosestPointIndexByDistance(distance) {
    console.log('[findClosestPointIndexByDistance] Finding index for distance:', distance);
    if (distance === null || distance === undefined) {
        console.warn('[findClosestPointIndexByDistance] Received null or undefined distance. Returning -1.');
        return -1;
    }
    if (!gpxData || !gpxData.points || gpxData.points.length === 0) {
        console.error('[findClosestPointIndexByDistance] No GPX data or points available. gpxData:', gpxData);
        return -1;
    }
    console.log('[findClosestPointIndexByDistance] Searching in points array of length:', gpxData.points.length);

    let closestIndex = -1;
    let minDiff = Infinity;
    gpxData.points.forEach((point, index) => {
        if (point.distanceFromStart === undefined || point.distanceFromStart === null) {
            // console.warn(`[findClosestPointIndexByDistance] Point ${index} has undefined/null distanceFromStart.`);
            return; // Skip this point
        }
        const diff = Math.abs(point.distanceFromStart - distance);
        if (diff < minDiff) {
            minDiff = diff;
            closestIndex = index;
        }
    });
    console.log('[findClosestPointIndexByDistance] Found closestIndex:', closestIndex, 'for distance:', distance, 'with minDiff:', minDiff);
    return closestIndex;
}

function calculateAndDisplayStats(currentGpxData, startIndex = -1, endIndex = -1) {
    console.log('[calculateAndDisplayStats] Called with startIndex:', startIndex, 'endIndex:', endIndex);
    const statsInnerContainer = document.getElementById('statsInnerContainer');
    if (!statsInnerContainer) {
        console.error("#statsInnerContainer element not found. Cannot display stats.");
        return;
    }

    let pointsToAnalyze = [];
    if (currentGpxData && currentGpxData.points) {
        if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex && startIndex >=0 && endIndex < currentGpxData.points.length) { // Ensure indices are valid
            pointsToAnalyze = currentGpxData.points.slice(startIndex, endIndex + 1);
        } else {
            // Default to all points if range is invalid or not specified
            pointsToAnalyze = currentGpxData.points;
            // Only log this message if we are actually falling back *because* of invalid/unspecified range,
            // not if the intention was always to use all points (e.g. initial load)
            if (startIndex !== -1 || endIndex !== -1) { // i.e. a range was attempted but was invalid
                 console.log('[calculateAndDisplayStats] Invalid or unspecified range, using all points. Start/End:', startIndex, endIndex, 'Total points:', currentGpxData.points.length);
            }
        }
    }

    console.log('[calculateAndDisplayStats] pointsToAnalyze length:', pointsToAnalyze.length);
    if (pointsToAnalyze.length > 0) {
        console.log('[calculateAndDisplayStats] pointsToAnalyze first p.dist:', pointsToAnalyze[0].distanceFromStart, 'last p.dist:', pointsToAnalyze[pointsToAnalyze.length - 1].distanceFromStart);
    }

    let statsData = [];

    if (pointsToAnalyze.length < 2) {
        const totalDistanceMeters = (startIndex === -1 && endIndex === -1 && currentGpxData && currentGpxData.totalDistance) ? currentGpxData.totalDistance : 0;
        const totalTimeInSeconds = 0;
        const calculatedAverageSpeedKmh = 0;
        const calculatedTotalAscent = 0;
        const calculatedMaxSpeedKmh = pointsToAnalyze.length === 1 && pointsToAnalyze[0].speed ? pointsToAnalyze[0].speed : 0;

        let message = "Not enough data points for detailed stats.";
        if (currentGpxData && currentGpxData.points && currentGpxData.points.length === 0) {
            message = "No GPX data loaded.";
        } else if (startIndex !== -1 && endIndex !== -1 && pointsToAnalyze.length === 0) { // A specific range was selected but it's empty
            message = "No data points in selected range.";
        } else if (startIndex !== -1 && endIndex !== -1 && pointsToAnalyze.length === 1) { // A specific range yields one point
            message = "Range too small for detailed stats.";
        } else if (pointsToAnalyze.length === 1) { // Full track has only one point
             message = "Only one data point available.";
        }


        statsData = [
            { label: "Info:", value: message },
            { label: "Dist:", value: `${(totalDistanceMeters / 1000).toFixed(2)} km` },
            { label: "Time:", value: formatDuration(totalTimeInSeconds) },
            { label: "Avg Spd:", value: `${calculatedAverageSpeedKmh.toFixed(1)} km/h` },
            { label: "Asc:", value: `${Math.round(calculatedTotalAscent)} m` },
            { label: "Max Spd:", value: `${calculatedMaxSpeedKmh.toFixed(1)} km/h` }
        ];
        // Special case for empty pointsToAnalyze when a range was explicitly selected
        if (pointsToAnalyze.length === 0 && startIndex !== -1 && endIndex !== -1) {
             statsData = [ {label: "Info:", value: "No data points in selected range."} ];
        }

    } else {
        // Sufficient points for calculation (pointsToAnalyze.length >= 2)
        // totalDistanceMeters is calculated based on the first and last point of the current analysis segment.
        // This is correct for both a slice (selected range) and the full track (when pointsToAnalyze = currentGpxData.points).
        const totalDistanceMeters = pointsToAnalyze[pointsToAnalyze.length - 1].distanceFromStart - pointsToAnalyze[0].distanceFromStart;

        const firstPointTime = pointsToAnalyze[0].time.getTime();
        const lastPointTime = pointsToAnalyze[pointsToAnalyze.length - 1].time.getTime();
        const totalTimeInSeconds = (lastPointTime - firstPointTime) / 1000;

        let calculatedAverageSpeedKmh = 0;
        if (totalTimeInSeconds > 0) { // Avoid division by zero if time difference is 0
            calculatedAverageSpeedKmh = (totalDistanceMeters / totalTimeInSeconds) * 3.6;
        }

        let calculatedTotalAscent = 0;
        for (let i = 1; i < pointsToAnalyze.length; i++) {
            const prevPoint = pointsToAnalyze[i - 1];
            const currentPoint = pointsToAnalyze[i];
            if (prevPoint.alt !== null && currentPoint.alt !== null && !isNaN(prevPoint.alt) && !isNaN(currentPoint.alt)) {
                if (currentPoint.alt > prevPoint.alt) {
                    calculatedTotalAscent += currentPoint.alt - prevPoint.alt;
                }
            }
        }

        let calculatedMaxSpeedKmh = 0;
        pointsToAnalyze.forEach(point => {
            if (point.speed !== null && !isNaN(point.speed) && point.speed > calculatedMaxSpeedKmh) {
                calculatedMaxSpeedKmh = point.speed;
            }
        });

        statsData = [
            { label: "Dist:", value: `${(totalDistanceMeters / 1000).toFixed(2)} km` },
            { label: "Time:", value: formatDuration(totalTimeInSeconds) },
            { label: "Avg Spd:", value: `${calculatedAverageSpeedKmh.toFixed(1)} km/h` },
            { label: "Asc:", value: `${Math.round(calculatedTotalAscent)} m` },
            { label: "Max Spd:", value: `${calculatedMaxSpeedKmh.toFixed(1)} km/h` }
        ];
    }

    console.log('[calculateAndDisplayStats] Final statsData to display:', JSON.stringify(statsData));
    statsInnerContainer.innerHTML = ''; // Clear previous stats
    statsData.forEach(stat => {
        const statElement = document.createElement('span');
        statElement.classList.add('stat-item');
        statElement.innerHTML = `<strong>${stat.label}</strong> ${stat.value}`;
        statsInnerContainer.appendChild(statElement);
    });
}

// Theme Switching Logic
const themeSelector = document.getElementById('theme');
const docElement = document.documentElement;

function applyTheme(theme) {
    let effectiveTheme = theme;
    if (theme === 'system') {
        effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    docElement.setAttribute('data-theme', effectiveTheme);
    localStorage.setItem('theme', theme); // Save the user's explicit choice
    console.log(`Applied theme: ${theme}, Effective theme: ${effectiveTheme}`);

    // Recreate charts if they exist to apply new theme colors
    // Ensure gpxData is available and populated
    if (currentGpxData && currentGpxData.points && currentGpxData.points.length > 0) {
        if (altitudeChart) {
            // altitudeChart.destroy(); // Already destroyed in createAltitudeChart
            createAltitudeChart(currentGpxData);
        }
        if (speedChart) {
            // speedChart.destroy(); // Already destroyed in createSpeedChart
            createSpeedChart(currentGpxData);
        }
    }
}

function loadTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        themeSelector.value = savedTheme;
        applyTheme(savedTheme);
    } else {
        themeSelector.value = 'system'; // Default to system
        applyTheme('system');
    }
}

themeSelector.addEventListener('change', (event) => {
    applyTheme(event.target.value);
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
    if (themeSelector.value === 'system') {
        applyTheme('system');
    }
});

// Initial load
loadTheme();

const resetSelectionButton = document.getElementById('resetSelectionBtn');

if (resetSelectionButton) {
    resetSelectionButton.addEventListener('click', () => {
        console.log('[Reset Button] Clicked.');

        // Reset zoom on altitude chart
        if (altitudeChart) {
            console.log('[Reset Button] Resetting Altitude Chart zoom.');
            altitudeChart.resetZoom('none');
            altitudeChart.update('none');
        }

        // Reset zoom on speed chart
        if (speedChart) {
            console.log('[Reset Button] Resetting Speed Chart zoom.');
            speedChart.resetZoom('none');
            speedChart.update('none');
        }

        // Clear the selectedRange global variable
        selectedRange = { startDistance: null, endDistance: null, startIndex: -1, endIndex: -1 };
        console.log('[Reset Button] selectedRange reset.');

        // Update stats and map highlight to reflect the full range
        console.log('[Reset Button] Calling updateStatsForRange to refresh for full track.');
        updateStatsForRange();
        // updateStatsForRange will call:
        //  - findClosestPointIndexByDistance (which will result in -1 for startIndex/endIndex)
        //  - calculateAndDisplayStats (which will use full dataset due to -1 indices)
        //  - updateMapHighlightForRange (which will remove range highlight due to -1 indices)
    });
} else {
    console.warn('#resetSelectionBtn not found.');
}
