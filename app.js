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
    if(gradPct < -2)  return "descent";
    if(gradPct < 2)   return "flat";
    if(gradPct < 5)   return "easy climb";
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
                segments.push({
                    startKm:  segStart,
                    endKm:    dist[i],
                    type:     segType,
                    avgGrad:  segGradSum / segCount,
                    avgPower: segPowerSum / segCount,
                    timeSec:  segTimeSum
                });
                segStart    = dist[i];
                segType     = type;
                segPowerSum = 0;
                segGradSum  = 0;
                segCount    = 0;
                segTimeSum  = 0;
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

        // render segments with carb reminders inserted at the right km
        let carbIndex = 0;
        let html = "";
        for(let s=0; s<segments.length; s++){
            let seg = segments[s];
            let c = terrainColor(seg.type);
            let emoji = terrainEmoji(seg.type);
            let mins = Math.round(seg.timeSec / 60);

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
                    &nbsp;|&nbsp; Est. time: <strong style="color:#111">${mins} min</strong>
                </span>
            </div>`;
        }

        document.getElementById("segments").innerHTML = html;

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
