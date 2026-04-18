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

function optimizePower(grad, ftp, IF){
    let base = ftp*IF;
    let adj = grad>0.06?0.15:grad>0.03?0.1:grad>-0.02?0:grad>-0.05?-0.15:-0.25;
    let p = base*(1+adj);
    return Math.max(ftp*0.5, Math.min(ftp*1.05, p));
}

function getTerrainType(gradPct){
    if(gradPct < 0)   return "descent";
    if(gradPct < 3)   return "flat";
    if(gradPct < 6)   return "easy climb";
    if(gradPct < 10)  return "super climb";
    return "hard climb";
}

function terrainColor(type){
    return {
        "descent":    "#3b82f6",
        "flat":       "#22c55e",
        "easy climb": "#f59e0b",
        "super climb":"#f97316",
        "hard climb": "#ef4444"
    }[type] || "gray";
}

function terrainEmoji(type){
    return {
        "descent":    "⬇️",
        "flat":       "➡️",
        "easy climb": "⬆️",
        "super climb":"🔺",
        "hard climb": "🚵"
    }[type] || "";
}

let chart;
function runCalc(){
    let ftp = +document.getElementById("ftp").value;
    let IF  = +document.getElementById("targetIF").value;
    let crr = +document.getElementById("crr").value;
    let file = document.getElementById("gpxFile").files[0];

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
    if(!ftp || !file){
        alert("Enter FTP + GPX");
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
                // scale real speed by gradient penalty
                let gradPenalty = Math.max(0.3, 1 - grad * 8);
                let powerBoost = power / (ftp * IF);
                return realSpeedMs * gradPenalty * powerBoost;
            }
            let baseSpeed = 8;
            let gradPenalty = Math.max(0.3, 1 - grad * 8);
            let powerBoost = power / (ftp * IF);
            return baseSpeed * gradPenalty * powerBoost;
        }

        // track hourly carb reminders
        let totalTimeSec = 0;
        let nextCarbHour = 3600;
        let carbReminders = [];

        // build per-point colors and terrain-based segments
        let colors = [];
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
            let power = optimizePower(grad, ftp, IF);
            let type = getTerrainType(gradPct);
            colors.push(terrainColor(type));

            let speed = estimateSpeed(power, grad);
            let timeSec = d / speed;
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
                    if(pendingDist >= 0.5){
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
                    <span style="font-weight:normal;font-size:13px;display:block;margin-top:2px;color:#9a3412">Eat 50–60g of carbs now (gel, bar, chews, or banana)</span>
                </div>`;
                carbIndex++;
            }

            html += `<div style="border-left:5px solid ${c};padding:10px 14px;margin:6px 0;border-radius:0 8px 8px 0;background:#f9fafb;font-size:15px;">
                <strong style="color:${c};font-size:16px">${emoji} ${seg.type.toUpperCase()}</strong>
                <span style="color:#374151;margin-left:8px">${seg.startKm.toFixed(1)} – ${seg.endKm.toFixed(1)} km</span>
                <span style="color:#6b7280;font-size:13px;display:block;margin-top:4px">
                    Avg grade: <strong style="color:#111">${seg.avgGrad.toFixed(1)}%</strong>
                    &nbsp;|&nbsp; Avg power: <strong style="color:#111">${Math.round(seg.avgPower)}W</strong>
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

        let finishBanner = `<div style="
            background: linear-gradient(135deg, #0077cc, #005fa3);
            border-radius: 10px;
            padding: 16px 20px;
            margin-top: 16px;
            color: white;
            text-align: center;
        ">
            <div style="font-size:13px;opacity:0.85;margin-bottom:4px">&#x1F3C1; Estimated finish time if you follow this plan</div>
            <div style="font-size:32px;font-weight:bold;letter-spacing:2px">
                ${eth}h ${etm}m ${ets}s
            </div>
            ${comparisonStr ? `<div style="margin-top:8px;font-size:14px">${comparisonStr}</div>` : ""}
        </div>`;

        document.getElementById("segments").innerHTML = prevBanner + html + finishBanner;

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
                    tension: 0.3
                }]
            },
            options:{
                responsive:true,
                plugins:{
                    legend:{ display:false }
                },
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
                    y:{
                        title:{ display:true, text:"Elevation (m)" }
                    }
                }
            }
        });
    };
    reader.readAsText(file);
}
