// collapsible panels
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".collapsible").forEach(btn => {
        btn.addEventListener("click", () => {
            let c = btn.nextElementSibling;
            c.style.maxHeight = c.style.maxHeight ? null : c.scrollHeight + "px";
        });
    });
});

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = x => x * Math.PI/180;
    let dLat = toRad(lat2-lat1);
    let dLon = toRad(lon2-lon1);
    let a = Math.sin(dLat/2)**2 +
        Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*
        Math.sin(dLon/2)**2;
    return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function optimizePower(grad, ftp, IF, windSpeed, windDir){
    let base = ftp*IF;
    let gradPct = grad * 100;
    let adj = gradPct >= 7  ?  0.20 :
              gradPct >= 5  ?  0.15 :
              gradPct >= 4  ?  0.10 :
              gradPct >= 3  ?  0.07 :
              gradPct >= 1  ?  0.03 :
              gradPct >= 0  ?  0    :
              gradPct >= -3 ? -0.10 : -0.20;
    let p = base*(1+adj);

    let windWatts = 0;
    if(windDir === "headwind")  windWatts =  (windSpeed / 10) * 5;
    if(windDir === "tailwind")  windWatts = -(windSpeed / 10) * 4;
    if(windDir === "crosswind") windWatts =  (windSpeed / 10) * 2;
    p += windWatts;

    return Math.max(ftp*0.5, Math.min(ftp*1.1, p));
}

function getTerrainType(gradPct){
    if(gradPct < 0)   return "descent";
    if(gradPct < 1)   return "flat";
    if(gradPct < 3)   return "elevated flat";
    if(gradPct < 4)   return "easy climb";
    if(gradPct < 5)   return "mid climb";
    if(gradPct < 7)   return "hard climb";
    return "super climb";
}

function terrainColor(type){
    return {
        "descent":       "#3b82f6",
        "flat":          "#22c55e",
        "elevated flat": "#84cc16",
        "easy climb":    "#f59e0b",
        "mid climb":     "#f97316",
        "hard climb":    "#ef4444",
        "super climb":   "#9333ea"
    }[type] || "gray";
}

function terrainEmoji(type){
    return {
        "descent":       "⬇️",
        "flat":          "➡️",
        "elevated flat": "↗️",
        "easy climb":    "⬆️",
        "mid climb":     "🔺",
        "hard climb":    "🚵",
        "super climb":   "💀"
    }[type] || "";
}

// tab switching between FTP and HR
function switchTab(tab){
    let isFTP = tab === 'ftp';
    document.getElementById('ftpSection').style.display = isFTP ? 'block' : 'none';
    document.getElementById('hrSection').style.display  = isFTP ? 'none' : 'block';
    document.getElementById('tabFTP').style.background = isFTP ? '#0077cc' : '#e5e7eb';
    document.getElementById('tabFTP').style.color      = isFTP ? 'white' : '#374151';
    document.getElementById('tabHR').style.background  = isFTP ? '#e5e7eb' : '#0077cc';
    document.getElementById('tabHR').style.color       = isFTP ? '#374151' : 'white';
}

// convert HR zone targets to equivalent effort level (0–1 scale like IF)
function hrZoneToIF(hrZ1, hrZ2, hrZ3, hrZ4, targetZone){
    // map zone to IF equivalent: Z1=0.55, Z2=0.70, Z3=0.85, Z4=0.95
    let zoneIF = { 1: 0.55, 2: 0.70, 3: 0.85, 4: 0.95 };
    return zoneIF[targetZone] || 0.75;
}

// get HR zone label from bpm
function getHRZone(bpm, z1, z2, z3, z4){
    if(bpm <= z1) return { zone: 1, label: "Zone 1 — Easy",      color: "#3b82f6" };
    if(bpm <= z2) return { zone: 2, label: "Zone 2 — Moderate",  color: "#22c55e" };
    if(bpm <= z3) return { zone: 3, label: "Zone 3 — Hard",      color: "#f59e0b" };
    if(bpm <= z4) return { zone: 4, label: "Zone 4 — Very hard", color: "#f97316" };
    return             { zone: 5, label: "Zone 5 — Max",         color: "#ef4444" };
}


async function fetchWind(){
    let file = document.getElementById("gpxFile").files[0];
    let status = document.getElementById("windStatus");
    let raceDate = document.getElementById("raceDate").value;
    let raceTime = document.getElementById("raceTime").value || "08:00";

    if(!file){
        status.textContent = "⚠️ Upload a GPX file first so we can read your race location.";
        status.style.color = "#f97316";
        return;
    }
    status.textContent = "📡 Fetching wind forecast...";
    status.style.color = "#6b7280";

    // read GPX to get start coordinates
    let text = await file.text();
    let xml = new DOMParser().parseFromString(text, "text/xml");
    let pts = xml.getElementsByTagName("trkpt");
    if(!pts.length){
        status.textContent = "⚠️ Could not read coordinates from GPX file.";
        status.style.color = "#f97316";
        return;
    }
    let lat = +pts[0].getAttribute("lat");
    let lon = +pts[0].getAttribute("lon");

    try {
        let url, speed, degrees, forecastLabel;
        let today = new Date().toISOString().split("T")[0];

        if(!raceDate || raceDate === today){
            // no date or today — use current conditions
            url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`;
            let res = await fetch(url);
            let data = await res.json();
            speed   = Math.round(data.current.wind_speed_10m);
            degrees = data.current.wind_direction_10m;
            forecastLabel = "Current conditions";
        } else {
            // future date — use hourly forecast
            let targetHour = parseInt(raceTime.split(":")[0]);
            url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh&start_date=${raceDate}&end_date=${raceDate}`;
            let res = await fetch(url);
            let data = await res.json();

            if(!data.hourly || !data.hourly.wind_speed_10m){
                // date too far in future (>16 days) — Open-Meteo only forecasts 16 days
                status.innerHTML = `⚠️ Forecast only available up to 16 days ahead. Your race date is too far away — check back closer to race day.`;
                status.style.color = "#f97316";
                return;
            }

            speed   = Math.round(data.hourly.wind_speed_10m[targetHour]);
            degrees = data.hourly.wind_direction_10m[targetHour];
            forecastLabel = `Forecast for ${raceDate} at ${raceTime}`;
        }

        document.getElementById("windSpeed").value = speed;
        let compassDir = degreesToCompass(degrees);

        status.innerHTML = `✅ <strong>${forecastLabel}</strong><br>
            Wind: <strong>${speed} km/h</strong> from the <strong>${compassDir}</strong> (${degrees}°)<br>
            <span style="font-size:11px;color:#9ca3af">Select headwind/tailwind/crosswind based on your race direction.</span>`;
        status.style.color = "#16a34a";

    } catch(err) {
        status.textContent = "⚠️ Could not fetch wind data. Check your connection and try again.";
        status.style.color = "#dc2626";
    }
}

function degreesToCompass(deg){
    let dirs = ["North","NE","East","SE","South","SW","West","NW"];
    return dirs[Math.round(deg / 45) % 8];
}

let chart, chart2;

function runCalc(){
    let ftp = +document.getElementById("ftp").value;
    let IF  = +document.getElementById("targetIF").value || 0.85;
    let windSpeed = +document.getElementById("windSpeed").value || 0;
    let windDir   = document.getElementById("windDir").value;
    let riderWeight = +document.getElementById("riderWeight").value || 70;
    let targetSpeed = +document.getElementById("targetSpeed").value || 0;
    let targetSpeedMs = targetSpeed / 3.6;
    let file = document.getElementById("gpxFile").files[0];

    // carb recommendation: ~1g per kg per hour, capped between 40g and 90g
    let carbsPerHour = Math.round(Math.min(90, Math.max(40, riderWeight * 1.0)));
    let carbLow  = Math.round(carbsPerHour * 0.85);
    let carbHigh = carbsPerHour;

    // determine mode: FTP or HR
    let usingHR = document.getElementById("hrSection").style.display !== "none";
    let hrZ1 = +document.getElementById("hrZ1").value;
    let hrZ2 = +document.getElementById("hrZ2").value;
    let hrZ3 = +document.getElementById("hrZ3").value;
    let hrZ4 = +document.getElementById("hrZ4").value;

    // validate — need either FTP or all 4 HR zones
    if(usingHR){
        if(!hrZ1 || !hrZ2 || !hrZ3 || !hrZ4){
            alert("Please fill in all 4 heart rate zones.");
            return;
        }
        // derive a pseudo-FTP from HR zones for power calculations
        // we use Zone 3 effort (0.85 IF equivalent) as the base
        // and set a notional FTP of 200W as reference (relative effort still works)
        ftp = 200;
        IF  = 0.85;
    } else {
        if(!ftp){
            alert("Please enter your FTP, or switch to Heart Rate mode.");
            return;
        }
    }

    // parse previous year data if entered
    let prevTimeInput = document.getElementById("prevTime").value.trim();
    let prevSpeed = +document.getElementById("prevSpeed").value;
    let prevTimeSec = 0;
    if(prevTimeInput){
        let parts = prevTimeInput.split(":").map(Number);
        if(parts.length === 2) prevTimeSec = parts[0]*3600 + parts[1]*60;
        if(parts.length === 3) prevTimeSec = parts[0]*3600 + parts[1]*60 + parts[2];
    }
    // use previous avg speed if provided, otherwise fall back to estimate
    let useRealSpeed = prevSpeed > 0;
    let realSpeedMs = prevSpeed / 3.6;

    if(!file){
        alert("Please upload a GPX file.");
        return;
    }
    let reader = new FileReader();
    reader.onload = function(e){
        let xml = new DOMParser().parseFromString(e.target.result,"text/xml");
        let pts = xml.getElementsByTagName("trkpt");
        let dist=[0], elev=[0], td=0;

        let firstEle = pts[0] ? pts[0].getElementsByTagName("ele")[0] : null;
        elev[0] = firstEle ? +firstEle.textContent : 0;

        for(let i=1;i<pts.length;i++){
            let p1=pts[i-1], p2=pts[i];
            let d = haversine(
                +p1.getAttribute("lat"),
                +p1.getAttribute("lon"),
                +p2.getAttribute("lat"),
                +p2.getAttribute("lon")
            );
            td+=d;
            dist.push(td/1000);
            let eleTag = p2.getElementsByTagName("ele")[0];
            elev.push(eleTag ? +eleTag.textContent : elev[elev.length-1]);
        }

        // estimate speed from power and gradient
        function estimateSpeed(power, grad){
            if(useRealSpeed){
                let gradPenalty = Math.max(0.3, 1 - grad * 8);
                let powerBoost = power / (ftp * IF);
                return realSpeedMs * gradPenalty * powerBoost;
            }
            if(targetSpeedMs > 0){
                let gradPenalty = Math.max(0.3, 1 - grad * 8);
                let powerBoost = power / (ftp * IF);
                return targetSpeedMs * gradPenalty * powerBoost;
            }
            let baseSpeed = 8;
            let gradPenalty = Math.max(0.3, 1 - grad * 8);
            let powerBoost = power / (ftp * IF);
            return baseSpeed * gradPenalty * powerBoost;
        }

        // if target speed set, calculate a power scale factor so avg speed hits target
        // we do a first pass to get baseline avg speed, then scale power to match
        let powerScaleFactor = 1.0;
        if(targetSpeedMs > 0 && !useRealSpeed){
            let totalDist = 0, totalTime = 0;
            for(let i=1;i<elev.length;i++){
                let d=(dist[i]-dist[i-1])*1000;
                if(d===0) continue;
                let grad=(elev[i]-elev[i-1])/d;
                let power = optimizePower(grad, ftp, IF, windSpeed, windDir);
                let gradPenalty = Math.max(0.3, 1 - grad * 8);
                let spd = 8 * gradPenalty * (power / (ftp * IF));
                totalTime += d / spd;
                totalDist += d;
            }
            let baseAvgSpeed = totalDist / totalTime;
            powerScaleFactor = targetSpeedMs / baseAvgSpeed;
            // cap scale factor to reasonable range
            powerScaleFactor = Math.max(0.5, Math.min(1.5, powerScaleFactor));
        }

        // track hourly carb reminders
        let totalTimeSec = 0;
        let nextCarbHour = 3600;
        let carbReminders = [];

        // build per-point colors and terrain-based segments
        let colors = [];
        let powerPoints = [];
        let speedPoints = [];
        let segments = [];
        let segType = null;
        let segStart = dist[1];
        let segPowerSum = 0, segGradSum = 0, segCount = 0, segTimeSum = 0;
        let pendingType = null, pendingDist = 0;

        for(let i=1;i<elev.length;i++){
            let d=(dist[i]-dist[i-1])*1000;
            if(d===0){ colors.push("gray"); continue; }
            let grad=(elev[i]-elev[i-1])/d;
            let gradPct = grad*100;
            let power = optimizePower(grad, ftp, IF, windSpeed, windDir) * powerScaleFactor;
            let type = getTerrainType(gradPct);
            colors.push(terrainColor(type));

            let speed = estimateSpeed(power, grad);
            let timeSec = d / speed;
            powerPoints.push(Math.round(power));
            speedPoints.push(+(speed * 3.6).toFixed(1));
            totalTimeSec += timeSec;

            if(totalTimeSec >= nextCarbHour){
                carbReminders.push({ km: dist[i], hour: Math.round(nextCarbHour/3600) });
                nextCarbHour += 3600;
            }

            if(segType === null) segType = type;

            if(type !== segType){
                // only switch terrain type if the new type persists for 0.5km
                // we do this by checking if pending type has accumulated enough distance
                if(!pendingType){
                    pendingType = type;
                    pendingDist = d / 1000;
                } else if(pendingType === type){
                    pendingDist += d / 1000;
                    if(pendingDist >= 0.25){
                        // commit the previous segment
                        segments.push({
                            startKm:  segStart,
                            endKm:    dist[i],
                            type:     segType,
                            avgGrad:  segGradSum / segCount,
                            avgPower: segPowerSum / segCount,
                            timeSec:  segTimeSum
                        });
                        segStart    = dist[i];
                        segType     = pendingType;
                        segPowerSum = 0;
                        segGradSum  = 0;
                        segCount    = 0;
                        segTimeSum  = 0;
                        pendingType = null;
                        pendingDist = 0;
                    }
                } else {
                    // different pending type — reset pending
                    pendingType = type;
                    pendingDist = d / 1000;
                }
            } else {
                pendingType = null;
                pendingDist = 0;
            }
            segPowerSum += power;
            segGradSum  += gradPct;
            segTimeSum  += timeSec;
            segCount++;
        }
        if(segCount > 0){
            segments.push({
                startKm:  segStart,
                endKm:    dist[dist.length-1],
                type:     segType,
                avgGrad:  segGradSum / segCount,
                avgPower: segPowerSum / segCount,
                timeSec:  segTimeSum
            });
        }

        // render wind banner if wind was entered
        let windBanner = "";
        if(windSpeed > 0){
            let windEmoji = windDir === "tailwind" ? "🟢" : windDir === "headwind" ? "🔴" : "🟡";
            let windImpact = windDir === "headwind" ? `+${((windSpeed/10)*5).toFixed(0)}W added to effort` :
                             windDir === "tailwind" ? `-${((windSpeed/10)*4).toFixed(0)}W reduced effort` :
                             `+${((windSpeed/10)*2).toFixed(0)}W slight penalty`;
            windBanner = `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px 16px;margin-bottom:12px;font-size:14px;color:#166534">
                <strong>💨 Wind Sock</strong>
                &nbsp;|&nbsp; ${windSpeed} km/h ${windDir}
                &nbsp;|&nbsp; ${windEmoji} ${windImpact}
            </div>`;
        }

        // render previous year summary if data was entered
        let prevBanner = "";
        if(prevTimeSec > 0 || prevSpeed > 0){
            let ph = Math.floor(prevTimeSec/3600);
            let pm = Math.floor((prevTimeSec%3600)/60);
            let timeStr = prevTimeSec > 0 ? `${ph}h ${pm}m` : "—";
            let speedStr = prevSpeed > 0 ? `${prevSpeed} km/h` : "—";
            prevBanner = `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;margin-bottom:12px;font-size:14px;color:#1e40af">
                <strong>&#x1F4C5; Previous year's race</strong>
                &nbsp;|&nbsp; Finish time: <strong>${timeStr}</strong>
                &nbsp;|&nbsp; Avg speed: <strong>${speedStr}</strong>
                <span style="display:block;margin-top:4px;font-size:12px;color:#3b82f6">
                    ${useRealSpeed ? "Timing estimates are based on your previous avg speed." : "Enter avg speed above for more accurate time estimates."}
                </span>
            </div>`;
        }

        // render segments with carb reminders inserted at the right km
        let carbIndex = 0;
        let html = "";
        for(let s=0; s<segments.length; s++){
            let seg = segments[s];
            let c = terrainColor(seg.type);
            let emoji = terrainEmoji(seg.type);
            let mins = Math.floor(seg.timeSec / 60);
            let secs = Math.round(seg.timeSec % 60);

            while(carbIndex < carbReminders.length && carbReminders[carbIndex].km <= seg.endKm){
                let r = carbReminders[carbIndex];
                html += `<div style="background:#fff7ed;border:2px solid #f97316;border-radius:8px;padding:10px 14px;margin:8px 0;font-size:15px;font-weight:bold;color:#c2410c;">
                    🍌 CARB REMINDER — Hour ${r.hour} (~${r.km.toFixed(1)} km)
                    <span style="font-weight:normal;font-size:13px;display:block;margin-top:2px;color:#9a3412">Eat ${carbLow}–${carbHigh}g of carbs now (gel, bar, chews, or banana)</span>
                </div>`;
                carbIndex++;
            }

            let effortStr = "";
            if(usingHR){
                // map avg power % of FTP to a HR zone
                let pct = seg.avgPower / ftp;
                let zone = pct > 0.95 ? 4 : pct > 0.85 ? 3 : pct > 0.70 ? 2 : 1;
                let zoneInfo = getHRZone(zone === 1 ? hrZ1 - 5 : zone === 2 ? hrZ2 - 5 : zone === 3 ? hrZ3 - 5 : hrZ4 - 5, hrZ1, hrZ2, hrZ3, hrZ4);
                effortStr = `Target: <strong style="color:${zoneInfo.color}">${zoneInfo.label}</strong>`;
            } else {
                effortStr = `Avg power: <strong style="color:#111">${Math.round(seg.avgPower)}W</strong>`;
            }

            html += `<div style="border-left:5px solid ${c};padding:10px 14px;margin:6px 0;border-radius:0 8px 8px 0;background:#f9fafb;font-size:15px;">
                <strong style="color:${c};font-size:16px">${emoji} ${seg.type.toUpperCase()}</strong>
                <span style="color:#374151;margin-left:8px">${seg.startKm.toFixed(1)} – ${seg.endKm.toFixed(1)} km</span>
                <span style="color:#6b7280;font-size:13px;display:block;margin-top:4px">
                    Avg grade: <strong style="color:#111">${seg.avgGrad.toFixed(1)}%</strong>
                    &nbsp;|&nbsp; ${effortStr}
                    &nbsp;|&nbsp; Est. time: <strong style="color:#111">${mins}m ${secs}s</strong>
                </span>
            </div>`;
        }

        // calculate total estimated time from all segments
        let totalEstSec = segments.reduce((sum, seg) => sum + seg.timeSec, 0);
        let eth = Math.floor(totalEstSec / 3600);
        let etm = Math.floor((totalEstSec % 3600) / 60);
        let ets = Math.round(totalEstSec % 60);

        // compare to previous year if available
        let comparisonStr = "";
        if(prevTimeSec > 0){
            let diff = prevTimeSec - totalEstSec;
            let absDiff = Math.abs(diff);
            let dh = Math.floor(absDiff / 3600);
            let dm = Math.floor((absDiff % 3600) / 60);
            let ds = Math.round(absDiff % 60);
            let diffLabel = dh > 0 ? `${dh}h ${dm}m ${ds}s` : dm > 0 ? `${dm}m ${ds}s` : `${ds}s`;
            if(diff > 0){
                comparisonStr = `<span style="color:#16a34a">&#x2B06; ${diffLabel} faster than last year</span>`;
            } else if(diff < 0){
                comparisonStr = `<span style="color:#dc2626">&#x2B07; ${diffLabel} slower than last year</span>`;
            } else {
                comparisonStr = `<span style="color:#6b7280">Same as last year</span>`;
            }
        }

        let actualAvgSpeed = totalEstSec > 0 ? ((dist[dist.length-1] / totalEstSec) * 3600).toFixed(1) : "—";

        let finishBanner = `<div style="
            background: #3d5220;
            border-radius: 10px;
            padding: 16px 20px;
            margin-top: 16px;
            color: #f0f5e8;
            text-align: center;
        ">
            <div style="font-size:13px;opacity:0.85;margin-bottom:4px">&#x1F3C1; Estimated finish time if you follow this plan</div>
            <div style="font-size:32px;font-weight:bold;letter-spacing:2px">
                ${eth}h ${etm}m ${ets}s
            </div>
            <div style="font-size:14px;margin-top:6px;opacity:0.9">Avg speed: ${actualAvgSpeed} km/h${targetSpeed > 0 ? ` (target: ${targetSpeed} km/h)` : ""}</div>
            ${comparisonStr ? `<div style="margin-top:8px;font-size:14px">${comparisonStr}</div>` : ""}
        </div>`;

        document.getElementById("segments").innerHTML = windBanner + prevBanner + html + finishBanner;

        if(chart) chart.destroy();
        chart = new Chart(document.getElementById("chart"),{
            type:"line",
            data:{
                labels: dist,
                datasets:[{
                    label:"Elevation (m)",
                    data: elev,
                    borderColor:"#0077cc",
                    backgroundColor:"rgba(0,119,204,0.1)",
                    pointBackgroundColor: colors,
                    pointRadius: 0,
                    fill: true,
                    tension: 0.3,
                    borderWidth: 2
                }]
            },
            options:{
                responsive:true,
                plugins:{ legend:{ display:false } },
                scales:{
                    x:{
                        ticks:{
                            maxTicksLimit:10,
                            callback: function(val, index){
                                return parseFloat(dist[index]).toFixed(1) + " km";
                            }
                        },
                        title:{ display:true, text:"Distance (km)" }
                    },
                    y:{ title:{ display:true, text:"Elevation (m)" } }
                }
            }
        });

        // second chart — power/HR left axis, speed + elevation right axis
        let distLabels = dist.slice(1).map(d => parseFloat(d).toFixed(2));
        if(chart2) chart2.destroy();
        chart2 = new Chart(document.getElementById("chart2"),{
            type:"line",
            data:{
                labels: distLabels,
                datasets:[
                    {
                        label: usingHR ? "Target HR zone" : "Power (W)",
                        data: powerPoints,
                        borderColor: "#ef4444",
                        backgroundColor: "rgba(239,68,68,0.08)",
                        pointRadius: 0,
                        borderWidth: 3,
                        tension: 0.3,
                        fill: false,
                        yAxisID: "yLeft"
                    },
                    {
                        label: "Speed (km/h)",
                        data: speedPoints,
                        borderColor: "#f97316",
                        backgroundColor: "rgba(249,115,22,0.08)",
                        pointRadius: 0,
                        borderWidth: 3,
                        tension: 0.3,
                        fill: false,
                        yAxisID: "yRight"
                    },
                    {
                        label: "Elevation (m)",
                        data: elev.slice(1),
                        borderColor: "#3b82f6",
                        backgroundColor: "rgba(59,130,246,0.08)",
                        pointRadius: 0,
                        borderWidth: 3,
                        tension: 0.3,
                        fill: true,
                        yAxisID: "yRight2"
                    }
                ]
            },
            options:{
                responsive: true,
                interaction:{ mode:"index", intersect:false },
                plugins:{
                    legend:{
                        display: true,
                        labels:{ color:"#f0f5e8", boxWidth:20, padding:16 }
                    },
                    tooltip:{
                        callbacks:{
                            title: items => `${items[0].label} km`,
                        }
                    }
                },
                scales:{
                    x:{
                        ticks:{
                            maxTicksLimit: 12,
                            color: "#c5d9a0",
                            callback: function(val, index){
                                return distLabels[index] ? parseFloat(distLabels[index]).toFixed(1) + " km" : "";
                            }
                        },
                        title:{ display:true, text:"Distance (km)", color:"#c5d9a0" },
                        grid:{ color:"rgba(197,217,160,0.15)" }
                    },
                    yLeft:{
                        type:"linear",
                        position:"left",
                        title:{ display:true, text: usingHR ? "HR Zone effort" : "Power (W)", color:"#ef4444" },
                        ticks:{ color:"#ef4444" },
                        grid:{ color:"rgba(197,217,160,0.15)" }
                    },
                    yRight:{
                        type:"linear",
                        position:"right",
                        title:{ display:true, text:"Speed (km/h)", color:"#f97316" },
                        ticks:{ color:"#f97316" },
                        grid:{ drawOnChartArea:false }
                    },
                    yRight2:{
                        type:"linear",
                        position:"right",
                        title:{ display:true, text:"Elevation (m)", color:"#3b82f6" },
                        ticks:{ color:"#3b82f6" },
                        grid:{ drawOnChartArea:false },
                        offset: true
                    }
                }
            }
        });
    };
    reader.readAsText(file);
}
