// JavaScript for GPX Analyzer & Editor will go here
console.log("script.js loaded");

// Register chartjs-plugin-zoom
// Assuming ChartZoom is exposed globally by the plugin script
if (typeof ChartZoom !== 'undefined') {
    Chart.register(ChartZoom);
    console.log("chartjs-plugin-zoom registered.");
} else {
    console.warn("ChartZoom plugin not found. Zoom functionality may not work.");
}

// Global Variables
let map;
let altitudeChart;
let speedChart;
let gpxData = { points: [], totalDistance: 0 };
let trackHighlightMarker;
let highlightDebounceTimeout; // For debouncing highlight updates

// Global state for selected range and active chart
let selectedRange = { min: null, max: null };
let activeSelectionChart = null; // To track which chart initiated a selection ('altitude' or 'speed')
let selectedTrackPolyline = null; // Holds the Leaflet layer for the highlighted track segment

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

            // Reset selection state when a new file is loaded
            resetChartSelectionAndZoom();

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
                }
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
            }, // Ensure this comma is here
            plugins: { // Single plugins object
                legend: {
                    labels: {
                        color: labelColor
                    }
                },
                zoom: { // Zoom plugin options
                    pan: {
                        enabled: true,
                        mode: 'x',
                    },
                    zoom: {
                        drag: {
                            enabled: true,
                            modifierKey: 'shift',
                            backgroundColor: 'rgba(75, 192, 192, 0.3)',
                            borderColor: 'rgba(75, 192, 192, 0.8)',
                        },
                        mode: 'x',
                        onZoomComplete: function({chart}) {
                            const newMin = chart.scales.x.min;
                            const newMax = chart.scales.x.max;

                            selectedRange.min = newMin;
                            selectedRange.max = newMax;
                            activeSelectionChart = 'altitude';
                            console.log('Altitude chart selection. Updated selectedRange:', selectedRange);

                            if (speedChart && speedChart.scales && speedChart.scales.x) {
                                if (speedChart.scales.x.min !== newMin || speedChart.scales.x.max !== newMax) {
                                    speedChart.zoomScale('x', {min: newMin, max: newMax}, 'none');
                                }
                            }
                            updateMapForRange(selectedRange.min, selectedRange.max);
                            if (gpxData && gpxData.points && selectedRange.min !== null && selectedRange.max !== null && selectedRange.min <= selectedRange.max) {
                                const selectedPoints = gpxData.points.slice(selectedRange.min, selectedRange.max + 1);
                                calculateAndDisplayStats(selectedPoints);
                            }
                        }
                    }
                }
                // annotation: { annotations: {} } // If you had annotations
            }
        }
    });

    if (altitudeChart && altitudeChart.canvas) {
        altitudeChart.canvas.addEventListener('dblclick', resetChartSelectionAndZoom);
    }
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
                }
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
            }, // Ensure this comma is here
            plugins: { // Single plugins object
                legend: {
                    labels: {
                        color: labelColor
                    }
                },
                zoom: { // Zoom plugin options
                    pan: {
                        enabled: true,
                        mode: 'x',
                    },
                    zoom: {
                        drag: {
                            enabled: true,
                            modifierKey: 'shift',
                            backgroundColor: 'rgba(75, 192, 192, 0.3)',
                            borderColor: 'rgba(75, 192, 192, 0.8)',
                        },
                        mode: 'x',
                        onZoomComplete: function({chart}) {
                            const newMin = chart.scales.x.min;
                            const newMax = chart.scales.x.max;

                            selectedRange.min = newMin;
                            selectedRange.max = newMax;
                            activeSelectionChart = 'speed';
                            console.log('Speed chart selection. Updated selectedRange:', selectedRange);

                            if (altitudeChart && altitudeChart.scales && altitudeChart.scales.x) {
                                if (altitudeChart.scales.x.min !== newMin || altitudeChart.scales.x.max !== newMax) {
                                    altitudeChart.zoomScale('x', {min: newMin, max: newMax}, 'none');
                                }
                            }
                            // This call was missing for speed chart, adding it for consistency
                            updateMapForRange(selectedRange.min, selectedRange.max);
                            if (gpxData && gpxData.points && selectedRange.min !== null && selectedRange.max !== null && selectedRange.min <= selectedRange.max) {
                                const selectedPoints = gpxData.points.slice(selectedRange.min, selectedRange.max + 1);
                                calculateAndDisplayStats(selectedPoints);
                            }
                        }
                    }
                }
                // annotation: { annotations: {} } // If you had annotations
            }
        }
    });

    if (speedChart && speedChart.canvas) {
        speedChart.canvas.addEventListener('dblclick', resetChartSelectionAndZoom);
    }
}

function resetChartSelectionAndZoom() {
    selectedRange.min = null;
    selectedRange.max = null;
    activeSelectionChart = null;

    if (altitudeChart) {
        altitudeChart.resetZoom('none');
    }
    if (speedChart) {
        speedChart.resetZoom('none');
    }
    console.log("Selection cleared and charts reset.");
    updateMapForRange(null, null); // Clear map selection highlight
    calculateAndDisplayStats(); // Recalculate for full track
}

function updateMapForRange(startIndex, endIndex) {
    if (!map) return; // Make sure map is initialized

    // Clear previous selection polyline
    if (selectedTrackPolyline && map.hasLayer(selectedTrackPolyline)) {
        map.removeLayer(selectedTrackPolyline);
    }
    selectedTrackPolyline = null;

    // Validate range
    if (startIndex === null || endIndex === null || startIndex < 0 || endIndex < startIndex || !gpxData.points || gpxData.points.length === 0) {
        // If selection is cleared or invalid, ensure map view fits the whole track if it exists
        if (gpxData.points && gpxData.points.length > 0) {
            const allLatLngs = gpxData.points.map(p => [p.lat, p.lon]);
            if (allLatLngs.length > 0) {
                 // map.fitBounds(allLatLngs); // Optionally reset to full track view
            }
        }
        return;
    }

    // Ensure indices are within bounds
    const maxPointIndex = gpxData.points.length - 1;
    const validStartIndex = Math.max(0, startIndex);
    // For slice, endIndex needs to be one more than the last desired index.
    // And ensure it doesn't exceed the array length.
    const validEndIndex = Math.min(maxPointIndex, endIndex);

    if (validStartIndex > validEndIndex) return; // Should not happen if logic is correct

    const selectedPoints = gpxData.points.slice(validStartIndex, validEndIndex + 1);

    if (selectedPoints.length > 0) {
        const latLngs = selectedPoints.map(p => [p.lat, p.lon]);
        selectedTrackPolyline = L.polyline(latLngs, {
            color: 'red', // Distinctive color for selection
            weight: 5,
            opacity: 0.75
        }).addTo(map);

        // Optional: Fit map to the selected bounds
        if (selectedTrackPolyline.getBounds().isValid()) {
            map.fitBounds(selectedTrackPolyline.getBounds(), {padding: [20, 20]});
        }
    }
}

function updateHighlight(index) {
    // Debounce logic
    clearTimeout(highlightDebounceTimeout);
    highlightDebounceTimeout = setTimeout(() => {
        if (!gpxData || !gpxData.points || index < 0 || index >= gpxData.points.length || !gpxData.points[index]) {
            // console.warn("Invalid index or data for highlight:", index);
            return;
        }
        const point = gpxData.points[index];

        // Map Highlight
        if (map && trackHighlightMarker) {
            trackHighlightMarker.setLatLng([point.lat, point.lon]);
            if (!map.hasLayer(trackHighlightMarker)) {
                trackHighlightMarker.addTo(map);
            }
            // Optional: Make marker more prominent, e.g., trackHighlightMarker.setOpacity(1);
        }

        // Altitude Chart Highlight
        if (altitudeChart && gpxData.points[index]) {
            if (!altitudeChart.getActiveElements() || altitudeChart.getActiveElements().length === 0 || altitudeChart.getActiveElements()[0].index !== index) {
                altitudeChart.setActiveElements([{ datasetIndex: 0, index: index }], { x:0, y:0 });
                altitudeChart.update(); // Update chart after setting active elements
            }
        }

        // Speed Chart Highlight
        if (speedChart && gpxData.points[index]) {
            if (!speedChart.getActiveElements() || speedChart.getActiveElements().length === 0 || speedChart.getActiveElements()[0].index !== index) {
                speedChart.setActiveElements([{ datasetIndex: 0, index: index }], { x:0, y:0 });
                speedChart.update(); // Update chart after setting active elements
            }
        }
        // console.log("Highlighting point index:", index, "Lat:", point.lat, "Lon:", point.lon);
    }, 10); // Debounce time in ms (e.g., 10-50ms)
}

function calculateAndDisplayStats(pointsSubset) {
    const statsContainer = document.getElementById('statsContainer');
    if (!statsContainer) {
        console.error("Stats container not found!");
        return;
    }

    const pointsToUse = (pointsSubset && pointsSubset.length > 0) ? pointsSubset : gpxData.points;

    let totalDistanceMeters = 0;
    let totalTimeInSeconds = 0;
    let calculatedAverageSpeedKmh = 0;
    let calculatedTotalAscent = 0;
    let calculatedMaxSpeedKmh = 0;

    if (pointsToUse && pointsToUse.length > 0) {
        if (pointsToUse.length > 1) {
            // Calculate distance:
            // If it's a subset, calculate from difference in distanceFromStart
            // If it's the full set, gpxData.totalDistance can be used (or calculated like a subset)
            if (pointsSubset && pointsSubset.length > 0 && pointsToUse.length < gpxData.points.length) { // It's a true subset
                 totalDistanceMeters = pointsToUse[pointsToUse.length - 1].distanceFromStart - pointsToUse[0].distanceFromStart;
            } else { // Full dataset or effectively full if subset matches gpxData.points
                totalDistanceMeters = gpxData.totalDistance; // Use pre-calculated total for full track
            }

            const firstPointTime = pointsToUse[0].time.getTime();
            const lastPointTime = pointsToUse[pointsToUse.length - 1].time.getTime();
            totalTimeInSeconds = (lastPointTime - firstPointTime) / 1000;
        } else { // Single point in selection
            totalDistanceMeters = 0; // No distance for a single point
            totalTimeInSeconds = 0;
        }


        if (totalTimeInSeconds > 0 && totalDistanceMeters > 0) { // Avg speed only if there's distance and time
            calculatedAverageSpeedKmh = (totalDistanceMeters / totalTimeInSeconds) * 3.6; // m/s to km/h
        }

        for (let i = 1; i < pointsToUse.length; i++) {
            const prevPoint = pointsToUse[i-1];
            const currentPoint = pointsToUse[i];
            if (prevPoint.alt !== null && currentPoint.alt !== null && !isNaN(prevPoint.alt) && !isNaN(currentPoint.alt)) {
                if (currentPoint.alt > prevPoint.alt) {
                    calculatedTotalAscent += currentPoint.alt - prevPoint.alt;
                }
            }
        }

        pointsToUse.forEach(point => {
            if (point.speed !== null && !isNaN(point.speed) && point.speed > calculatedMaxSpeedKmh) {
                calculatedMaxSpeedKmh = point.speed;
            }
        });

    } // else, all stats remain 0 or "N/A" will be handled by formatting

    // Format for display
    const distanceKmDisplay = (pointsToUse && pointsToUse.length > 0) ? (totalDistanceMeters / 1000).toFixed(2) : "N/A";
    const formattedTimeDisplay = (pointsToUse && pointsToUse.length > 1) ? formatDuration(totalTimeInSeconds) : "N/A";
    const avgSpeedKmhDisplay = (calculatedAverageSpeedKmh > 0) ? calculatedAverageSpeedKmh.toFixed(1) : "N/A";
    const totalAscentMetersFormattedDisplay = (pointsToUse && pointsToUse.length > 0) ? Math.round(calculatedTotalAscent) : "N/A";
    const maxSpeedKmhDisplay = (pointsToUse && pointsToUse.length > 0 && calculatedMaxSpeedKmh > 0) ? calculatedMaxSpeedKmh.toFixed(1) : "N/A";


    const statsData = [
        { label: "Dist:", value: `${distanceKmDisplay} km` },
        { label: "Time:", value: formattedTimeDisplay },
        { label: "Avg Spd:", value: `${avgSpeedKmhDisplay} km/h` },
        { label: "Asc:", value: `${totalAscentMetersFormattedDisplay} m` },
        { label: "Max Spd:", value: `${maxSpeedKmhDisplay} km/h` }
    ];
    // Get the statsInnerContainer, which is now expected to be in index.html
    const statsInnerContainer = document.getElementById('statsInnerContainer');
    if (!statsInnerContainer) {
        console.error("#statsInnerContainer element not found. Cannot display stats.");
        return;
    }

    // Clear any previous content from statsInnerContainer
    statsInnerContainer.innerHTML = '';

    // Append new stat items
    statsData.forEach(stat => { // statsData is calculated earlier in the function
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
    if (gpxData && gpxData.points && gpxData.points.length > 0) {
        if (altitudeChart) {
            // altitudeChart.destroy(); // Already destroyed in createAltitudeChart
            createAltitudeChart(gpxData);
        }
        if (speedChart) {
            // speedChart.destroy(); // Already destroyed in createSpeedChart
            createSpeedChart(gpxData);
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
