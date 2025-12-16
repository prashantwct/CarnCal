// app.js

    // --- APP LOGIC ---
    function switchTab(t){
        document.querySelectorAll('.tab, .tab-content').forEach(e=>e.classList.remove('active'));
        document.getElementById(t).classList.add('active');
        const map={'tab-calc':0,'tab-immob':1,'tab-morph':2,'tab-settings':3,'tab-ref':4,'tab-hist':5};
        document.querySelectorAll('.tab')[map[t]].classList.add('active');
        window.scrollTo(0,0);
    }
    function toggleHelp(id) { document.getElementById(id).classList.toggle('active'); }
    function autoSave() { const s = document.getElementById('saveStatus'); s.style.display='block'; setTimeout(()=>s.style.display='none', 2000); }

    // --- FUNCTIONAL IMPROVEMENT: AUTO-TRANSFER WEIGHT ---
    function updateCalcWeight() {
        const actualWeight = document.getElementById('weight_act').value;
        const calcWeight = document.getElementById('calc_weight');
        if (actualWeight > 0) {
            calcWeight.value = actualWeight;
            recalcAll();
        }
    }

    // --- ANAESTHESIA TIMER ---
    let timerInterval;
    function startAnaesthesiaTimer() {
        if(timerInterval) clearInterval(timerInterval);
        const startTimeInput = document.getElementById('time_dart').value;
        const display = document.getElementById('timer_readout');
        const widget = document.getElementById('anaesthesia_timer');
        const handMin = document.getElementById('clock_min');
        const handSec = document.getElementById('clock_sec');

        if(!startTimeInput) {
            display.innerText = "NOT STARTED";
            handMin.style.transform = `translateX(-50%) rotate(0deg)`;
            handSec.style.transform = `translateX(-50%) rotate(0deg)`;
            widget.classList.remove('warning');
            return;
        }

        const [h, m] = startTimeInput.split(':').map(Number);
        const start = new Date();
        start.setHours(h, m, 0, 0);

        timerInterval = setInterval(() => {
            const current = new Date();
            const diffMs = current - start;
            if(diffMs < 0) return;

            const diffSecs = Math.floor(diffMs / 1000);
            const minutes = Math.floor(diffSecs / 60);
            const seconds = diffSecs % 60;

            display.innerText = `${minutes}m ${seconds}s`;
            const degSec = seconds * 6;
            const degMin = (minutes * 6) + (seconds * 0.1);

            handSec.style.transform = `translateX(-50%) rotate(${degSec}deg)`;
            handMin.style.transform = `translateX(-50%) rotate(${degMin}deg)`;

            if(minutes >= 35) widget.classList.add('warning');
            else widget.classList.remove('warning');
        }, 1000);
    }

    // --- DRUG REPOSITORY ---
    let drugRepo = [];
    const defaultDrugs = [
        {name: "Ketamine", dose: 4.0, conc: 100},
        {name: "Xylazine", dose: 1.0, conc: 100},
        {name: "Medetomidine", dose: 0.05, conc: 1}, 
        {name: "Tiletamine-Zol", dose: 2.0, conc: 100},
        {name: "Atipamezole", dose: 0.25, conc: 5}
    ];

    function loadDrugRepo() {
        const saved = localStorage.getItem('carnivore_drugs');
        if(saved) drugRepo = JSON.parse(saved);
        else { drugRepo = defaultDrugs; localStorage.setItem('carnivore_drugs', JSON.stringify(drugRepo)); }
        renderRepoList();
    }

    function saveDrugToRepo() {
        const n = document.getElementById('new_drug_name').value;
        const d = parseFloat(document.getElementById('new_drug_dose').value);
        const c = parseFloat(document.getElementById('new_drug_conc').value);
        if(!n || !d || !c) { alert("Fill all fields"); return; }
        drugRepo.push({name:n, dose:d, conc:c});
        localStorage.setItem('carnivore_drugs', JSON.stringify(drugRepo));
        renderRepoList();
        alert("Drug Added");
        document.getElementById('new_drug_name').value='';
    }

    function deleteDrugFromRepo(i) {
        if(!confirm("Remove from Library?")) return;
        drugRepo.splice(i, 1);
        localStorage.setItem('carnivore_drugs', JSON.stringify(drugRepo));
        renderRepoList();
    }

    function renderRepoList() {
        const div = document.getElementById('repoList');
        div.innerHTML = "";
        if(drugRepo.length === 0) { div.innerHTML = "No custom drugs."; return; }
        const tbl = document.createElement('table');
        tbl.innerHTML = `<thead><tr><th>Name</th><th>Dose</th><th>Conc</th><th></th></tr></thead><tbody></tbody>`;
        drugRepo.forEach((d, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${d.name}</td><td>${d.dose}</td><td>${d.conc}</td><td><button class="btn-sm" style="color:red;border:none;" onclick="deleteDrugFromRepo(${i})">X</button></td>`;
            tbl.querySelector('tbody').appendChild(tr);
        });
        div.appendChild(tbl);
    }

    // --- CALCULATOR ---
    function addDrugRow(name="", dose="", conc="") {
        const id = 'r'+Date.now();
        let opts = `<option value="">Select Drug...</option>`;
        drugRepo.forEach((d, i) => { opts += `<option value="${i}">${d.name}</option>`; });
        createRow('calcTable', `<td id="${id}"><select class="log-input" style="text-align:left; font-weight:bold; color:var(--primary);" onchange="fillDrugRow(this)">${opts}</select><input type="text" class="log-input calc-name-custom" placeholder="Or type custom" value="${name}" style="font-size:0.8rem; margin-top:2px;"></td><td><input type="number" class="c-dose log-input" value="${dose}" oninput="recalcAll()"></td><td><input type="number" class="c-conc log-input" value="${conc}" oninput="recalcAll()"></td><td class="c-vol" style="font-weight:bold; color:var(--primary); text-align:center;">0.0</td><td onclick="document.getElementById('${id}').parentElement.remove(); recalcAll();" style="color:red; font-weight:bold; cursor:pointer;">X</td>`);
    }

    function fillDrugRow(selectEl) {
        const idx = selectEl.value;
        if(idx === "") return;
        const drug = drugRepo[idx];
        const tr = selectEl.closest('tr');
        tr.querySelector('.c-dose').value = drug.dose;
        tr.querySelector('.c-conc').value = drug.conc;
        recalcAll();
    }

    // --- FUNCTIONAL IMPROVEMENT: DIVISION BY ZERO CHECK ---
    function recalcAll() {
        const wt = parseFloat(document.getElementById('calc_weight').value)||0;
        let tot=0;
        document.querySelectorAll('#calcTable tbody tr').forEach(r=>{
            const d = parseFloat(r.querySelector('.c-dose').value)||0;
            const c = parseFloat(r.querySelector('.c-conc').value)||0;
            const cell = r.querySelector('.c-vol');
            
            if (c === 0) {
                cell.innerText = "Error: Conc=0";
            } else {
                const v = (wt*d)/c;
                if(isFinite(v) && v>0) { cell.innerText=v.toFixed(2); tot+=v; } else { cell.innerText="0.0"; }
            }
        });
        document.getElementById('resultBox').style.display = tot>0?'block':'none';
        document.getElementById('total_vol_display').innerText = tot.toFixed(2);
    }

    function useAsUsedDose() {
        if(!confirm("Copy to Used Doses?")) return;
        const now = new Date().toTimeString().substr(0,5);
        document.querySelectorAll('#calcTable tbody tr').forEach(r => {
            const sel = r.querySelector('select');
            let name = (sel && sel.value !== "") ? sel.options[sel.selectedIndex].text : r.querySelector('.calc-name-custom').value;
            const vol = parseFloat(r.querySelector('.c-vol').innerText);
            const conc = parseFloat(r.querySelector('.c-conc').value);
            if (name && vol > 0 && conc > 0) addTopupRow([now, name, (vol*conc).toFixed(1), 'IM']);
        });
        alert("Doses copied.");
    }

    // --- UTILS ---
    // --- FUNCTIONAL IMPROVEMENT: GPS TIMEOUT ---
    function getGPS() {
        const s = document.getElementById('gps_status'); 
        const t = document.getElementById('gps_text');
        if(!navigator.geolocation) { s.innerText="GPS not supported."; return; }
        s.innerText="Locating..."; t.innerText="Acquiring...";
        navigator.geolocation.getCurrentPosition(
            p => {
                document.getElementById('gps_n').value = p.coords.latitude.toFixed(6);
                document.getElementById('gps_e').value = p.coords.longitude.toFixed(6);
                s.innerText = `Accuracy: ${p.coords.accuracy.toFixed(1)}m`; t.innerText="Update GPS"; s.style.color="green"; autoSave();
            }, 
            e => { s.innerText="GPS Failed."; t.innerText="Retry GPS"; s.style.color="red"; },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 } // Added options
        );
    }

    const ids = ['date','time','gps_n','gps_e','species','animal_id','animal_sex','animal_age','body_condition','anaesthesia_risk','reason_immob','veterinarians','weight_est','weight_act','time_dart','time_down','rev_drug','rev_route','time_rev','time_headup','time_standing','rel_notes','m_total_len','m_shoulder','m_chest','m_neck','m_head_circ','m_paw_fore','m_paw_hind','m_paw_fore_len','m_paw_hind_len','m_canine_ul','m_canine_ur','m_canine_ll','m_canine_lr','m_icd_up','m_icd_low'];
    
    function createRow(tableId, html) { const row = document.createElement('tr'); row.innerHTML=html; document.querySelector(`#${tableId} tbody`).appendChild(row); }
    
    // --- FUNCTIONAL IMPROVEMENT: LOG DELETION ---
    function addLogStep(v=null) { 
        const t = v?v[0]:new Date().toTimeString().substr(0,5); 
        createRow('logTable', `<td><input type="time" class="log-input" value="${t}"></td><td><input type="number" class="log-input" value="${v?v[1]:''}"></td><td><input type="number" class="log-input" value="${v?v[2]:''}"></td><td><input type="number" class="log-input" value="${v?v[3]:''}"></td><td><input type="text" class="log-input" value="${v?v[4]:''}"></td><td onclick="this.parentElement.remove()" style="color:red; font-weight:bold; cursor:pointer;">X</td>`); 
    }
    
    // --- FUNCTIONAL IMPROVEMENT: TOPUP DELETION ---
    function addTopupRow(v=null) { 
        const t = v?v[0]:new Date().toTimeString().substr(0,5); 
        const sel = v?v[3]:'IV'; 
        createRow('topupTable', `<td><input type="time" class="log-input" value="${t}"></td><td><input type="text" class="log-input" placeholder="Drug" value="${v?v[1]:''}"></td><td><input type="number" class="log-input" placeholder="mg" value="${v?v[2]:''}"></td><td><select class="log-input"><option ${sel=='IV'?'selected':''}>IV</option><option ${sel=='IM'?'selected':''}>IM</option></select></td><td onclick="this.parentElement.remove()" style="color:red; font-weight:bold; cursor:pointer;">X</td>`); 
    }

    function saveToHistory() {
        const id = document.getElementById('animal_id').value || "Unknown";
        let rec = {id:id, date: document.getElementById('date').value, species: document.getElementById('species').value, logs:[], topups:[]};
        ids.forEach(k=>{ if(document.getElementById(k)) rec[k] = document.getElementById(k).value; });
        // Logs and Topups are saved with only the original 5/4 data fields, excluding the 'X' column.
        document.querySelectorAll('#logTable tbody tr').forEach(r=>{ 
            let d=[]; 
            r.querySelectorAll('input:not([type="time"]), input[type="time"]').forEach(i=>d.push(i.value)); 
            rec.logs.push(d.slice(0, 5)); 
        });
        document.querySelectorAll('#topupTable tbody tr').forEach(r=>{ 
            let d=[]; 
            r.querySelectorAll('input, select').forEach(i=>d.push(i.value)); 
            rec.topups.push(d.slice(0, 4)); 
        });
        let h = JSON.parse(localStorage.getItem('carnivore_db')||"[]").filter(x=>x.id!==id); h.unshift(rec); localStorage.setItem('carnivore_db', JSON.stringify(h)); alert("Saved to History!"); renderHistory();
    }
    
    function renderHistory() {
        const l = document.getElementById('historyList'); l.innerHTML=""; const h = JSON.parse(localStorage.getItem('carnivore_db')||"[]");
        if(h.length===0) l.innerHTML="<div style='text-align:center; padding:20px; color:#aaa;'>No records</div>";
        h.forEach((r,i)=>{ const d=document.createElement('div'); d.style.cssText="padding:15px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;"; d.innerHTML = `<div><strong>${r.id}</strong> <span style="font-size:0.8rem; background:#eee; padding:2px 6px; border-radius:4px;">${r.species}</span><br><small style="color:#888">${r.date}</small></div><div><button class="btn-outline" style="display:inline; width:auto; padding:5px 10px; margin-right:5px;" onclick="loadRec(${i})">Load</button><button class="btn-sm" style="color:red; border:none; background:#ffebee;" onclick="delRec(${i})">X</button></div>`; l.appendChild(d); });
    }
    
    function loadRec(i) {
        const r = JSON.parse(localStorage.getItem('carnivore_db'))[i]; ids.forEach(k=>{ if(document.getElementById(k)) document.getElementById(k).value=r[k]||""; });
        document.querySelector('#logTable tbody').innerHTML=""; r.logs.forEach(l=>addLogStep(l)); document.querySelector('#topupTable tbody').innerHTML=""; r.topups.forEach(l=>addTopupRow(l)); switchTab('tab-immob');
    }
    function delRec(i) { if(!confirm("Delete?")) return; let h = JSON.parse(localStorage.getItem('carnivore_db')); h.splice(i,1); localStorage.setItem('carnivore_db', JSON.stringify(h)); renderHistory(); }

    function exportCSV() {
        let c = "Field,Value\n"; ids.forEach(k=>{ const el=document.getElementById(k); if(el) c+=`${k},${el.value}\n`; });
        c+="\nMONITORING LOGS\nTime,HR,RR,SpO2,Note\n"; document.querySelectorAll('#logTable tbody tr').forEach(r=>{ 
            let l=[]; 
            r.querySelectorAll('input:not([type="time"]), input[type="time"]').forEach(i=>l.push(i.value)); 
            c+=l.slice(0, 5).join(',')+"\n"; 
        });
        c+="\nTOP-UP DOSES\nTime,Drug,mg,Route\n"; document.querySelectorAll('#topupTable tbody tr').forEach(r=>{ 
            let l=[]; 
            r.querySelectorAll('input, select').forEach(i=>l.push(i.value)); 
            c+=l.slice(0, 4).join(',')+"\n"; 
        });
        const b = new Blob([c],{type:'text/csv'}); const a = document.createElement('a'); a.href=URL.createObjectURL(b); a.download=(document.getElementById('animal_id').value||"data")+".csv"; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
    function clearForm() { if(confirm("Clear Form?")) { document.querySelectorAll('input').forEach(i=>i.value=""); document.querySelector('#logTable tbody').innerHTML=""; document.querySelector('#topupTable tbody').innerHTML=""; document.getElementById('date').valueAsDate = new Date(); addLogStep(); document.querySelector('#calcTable tbody').innerHTML=""; addDrugRow(); } }
    
    function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }

    function downloadBackup() {
        const backup = { history: JSON.parse(localStorage.getItem('carnivore_db') || "[]"), drugs: JSON.parse(localStorage.getItem('carnivore_drugs') || "[]"), date: new Date().toISOString() };
        const blob = new Blob([JSON.stringify(backup, null, 2)], {type: 'application/json'});
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = "CarnCal_Backup_" + new Date().toISOString().slice(0,10) + ".json"; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }

    function restoreBackup(input) {
        const file = input.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = JSON.parse(e.target.result);
                if (data.history && data.drugs) {
                    if(confirm(`Restore ${data.history.length} records?`)) { localStorage.setItem('carnivore_db', JSON.stringify(data.history)); localStorage.setItem('carnivore_drugs', JSON.stringify(data.drugs)); alert("Restored!"); location.reload(); }
                } else { alert("Invalid backup."); }
            } catch (err) { alert("Error parsing file."); }
        }; reader.readAsText(file);
    }

    function checkStorageUsage() {
        let total = 0; for (let x in localStorage) { if (localStorage.hasOwnProperty(x)) total += ((localStorage[x].length * 2) / 1024 / 1024); }
        if (total > 4.0) alert("Warning: App storage > 4MB. Download backup.");
    }

    let wakeLock = null;
    async function requestWakeLock() { try { wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {} }
    document.addEventListener('visibilitychange', async () => { if (wakeLock !== null && document.visibilityState === 'visible') await requestWakeLock(); });

    function printPDF() {
        const c = document.getElementById('print-container');
        let html = `<div class="p-header"><h1>Anaesthesia Monitoring Sheet</h1><p>Generated: ${new Date().toLocaleString()}</p></div>
        <div class="p-section"><div class="p-sec-title">I. Team & Identity</div>
        <div class="p-grid"><div class="p-row"><span class="p-label">Vets:</span> <span class="p-val">${val('veterinarians')}</span></div><div class="p-row"><span class="p-label">ID:</span> <span class="p-val">${val('animal_id')}</span></div></div>
        <div class="p-grid"><div class="p-row"><span class="p-label">Species:</span> <span class="p-val">${val('species')}</span></div><div class="p-row"><span class="p-label">Date:</span> <span class="p-val">${val('date')}</span></div></div>
        <div class="p-grid"><div class="p-row"><span class="p-label">Sex:</span> <span class="p-val">${val('animal_sex')}</span></div><div class="p-row"><span class="p-label">Age:</span> <span class="p-val">${val('animal_age')}</span></div></div>
        <div class="p-grid"><div class="p-row"><span class="p-label">BCS:</span> <span class="p-val">${val('body_condition')}</span></div><div class="p-row"><span class="p-label">Risk:</span> <span class="p-val">${val('anaesthesia_risk')}</span></div></div>
        <div class="p-row"><span class="p-label">Reason:</span> <span class="p-val">${val('reason_immob')}</span></div></div>
        <div class="p-section"><div class="p-sec-title">II. Vitals & Timeline</div><div class="p-grid"><div class="p-row"><span class="p-label">Wt (Act):</span> <span class="p-val">${val('weight_act')}</span></div><div class="p-row"><span class="p-label">Wt (Est):</span> <span class="p-val">${val('weight_est')}</span></div></div><div class="p-grid"><div class="p-row"><span class="p-label">Darted:</span> <span class="p-val">${val('time_dart')}</span></div><div class="p-row"><span class="p-label">Down:</span> <span class="p-val">${val('time_down')}</span></div></div></div>
        <div class="p-section"><div class="p-sec-title">III. Drugs Used</div><table class="p-table"><thead><tr><th>Time</th><th>Drug</th><th>mg</th><th>Route</th></tr></thead><tbody>`;
        document.querySelectorAll('#topupTable tbody tr').forEach(r=>{ 
            let d=[]; 
            r.querySelectorAll('input, select').forEach(i=>d.push(i.value)); 
            if(d[1]) html+=`<tr><td>${d[0]}</td><td>${d[1]}</td><td>${d[2]}</td><td>${d[3]}</td></tr>`; 
        });
        html+=`</tbody></table></div>
        <div class="p-section"><div class="p-sec-title">IV. Monitoring Log</div><table class="p-table"><thead><tr><th>Time</th><th>HR</th><th>RR</th><th>SpO2</th><th>Notes</th></tr></thead><tbody>`;
        document.querySelectorAll('#logTable tbody tr').forEach(r=>{ 
            let d=[]; 
            r.querySelectorAll('input:not([type="time"]), input[type="time"]').forEach(i=>d.push(i.value)); 
            if(d[0]) html+=`<tr><td>${d[0]}</td><td>${d[1]}</td><td>${d[2]}</td><td>${d[3]}</td><td>${d[4]}</td></tr>`; 
        });
        html+=`</tbody></table></div>
        <div class="p-section"><div class="p-sec-title">V. Morphometry</div><div class="p-grid"><div class="p-row"><span class="p-label">Total Len:</span> <span class="p-val">${val('m_total_len')}</span></div><div class="p-row"><span class="p-label">Shoulder:</span> <span class="p-val">${val('m_shoulder')}</span></div></div><div class="p-grid"><div class="p-row"><span class="p-label">Chest:</span> <span class="p-val">${val('m_chest')}</span></div><div class="p-row"><span class="p-label">Neck:</span> <span class="p-val">${val('m_neck')}</span></div></div></div>`;
        c.innerHTML = html; window.print();
    }

    // --- SERVICE WORKER REGISTRATION (OFFLINE SUPPORT) ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => console.log('Service Worker registered'))
                .catch(err => console.log('Service Worker failed', err));
        });
    }

    // INIT
    document.getElementById('date').valueAsDate = new Date();
    loadDrugRepo();
    addLogStep();
    addDrugRow();
    renderHistory();
    checkStorageUsage();
    requestWakeLock();
