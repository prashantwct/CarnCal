// app.js

    // --- CONFIG ---
    const APP_VERSION = '1.1.0';
    const CONFIG = {
        STORAGE_WARN_MB: 4.0,
        ANAESTHESIA_WARNING_MIN: 35,
        GPS_TIMEOUT_MS: 10000
    };

    // --- SAFE STORAGE WRITE ---
    // Wraps localStorage.setItem so a full quota (common on old field
    // devices with years of history) throws a visible warning instead of
    // silently killing the save with no feedback to the vet in the field.
    function safeSetItem(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (err) {
            console.error(`[CarnCal] Failed to save "${key}"`, err);
            alert('Storage is full or unavailable, so this could not be saved. Please download a backup (My Drugs → Download Full Backup) and free up space, e.g. by removing old records.');
            return false;
        }
    }

    // --- XSS-SAFE TEXT INSERTION ---
    // All user-entered strings (drug names, animal IDs, notes, restored
    // backup content) go through this before landing in innerHTML.
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // --- CSV-SAFE FIELD ESCAPING ---
    // Quotes any field containing a comma, quote, or newline and doubles
    // internal quotes, per RFC 4180, so free-text notes with commas don't
    // silently corrupt the exported columns.
    function csvEscape(v) {
        const s = (v === null || v === undefined) ? '' : String(v);
        if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    // --- APP LOGIC ---
    function switchTab(t){
        document.querySelectorAll('.tab, .tab-content').forEach(e=>e.classList.remove('active'));
        document.getElementById(t).classList.add('active');
        const map={'tab-case':0,'tab-calc':1,'tab-monitor':2,'tab-morph':3,'tab-ref':4,'tab-settings':5,'tab-hist':6};
        document.querySelectorAll('.tab')[map[t]].classList.add('active');
        window.scrollTo(0,0);
    }
    function toggleHelp(id) { document.getElementById(id).classList.toggle('active'); }
    function autoSave() { const s = document.getElementById('saveStatus'); s.style.display='block'; setTimeout(()=>s.style.display='none', 2000); }

    // --- HEADER WEIGHT BADGE ---
    // The Calculator weight now lives on its own tab, away from Case/
    // Monitoring — this keeps the current value visible everywhere via
    // the sticky header instead of requiring a tab switch to check it.
    function updateWeightBadge() {
        const w = parseFloat(document.getElementById('calc_weight').value);
        const badge = document.getElementById('weightBadge');
        if (isFinite(w) && w > 0) {
            document.getElementById('weightBadgeVal').textContent = w;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }

    // --- FUNCTIONAL IMPROVEMENT: AUTO-TRANSFER WEIGHT ---
    function updateCalcWeight() {
        const actualWeight = document.getElementById('weight_act').value;
        const calcWeight = document.getElementById('calc_weight');
        if (actualWeight > 0) {
            calcWeight.value = actualWeight;
            recalcAll();
            updateWeightBadge();
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

            if(minutes >= CONFIG.ANAESTHESIA_WARNING_MIN) widget.classList.add('warning');
            else widget.classList.remove('warning');
        }, 1000);
    }

    // --- SAFE STORAGE READ ---
    // Wraps localStorage + JSON.parse so a single corrupted write (bad
    // shutdown mid-write, storage quota edge case, etc.) can't throw and
    // break history/drug rendering entirely. Falls back gracefully and
    // warns instead of silently losing data or crashing.
    function safeParse(key, fallback) {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        try {
            return JSON.parse(raw);
        } catch (err) {
            console.warn(`[CarnCal] Corrupted data for "${key}", using fallback.`, err);
            alert(`Warning: saved data for "${key}" appears corrupted and couldn't be read, so it was reset to avoid crashing the app. If you have a backup file, use "Restore from Backup" in My Drugs.`);
            return fallback;
        }
    }

    // --- DRUG REPOSITORY ---
    let drugRepo = [];
    const DRUG_CATEGORIES = ['Anaesthetic', 'Reversal', 'Emergency', 'Antibiotic', 'Analgesic', 'Anti-parasitic', 'Custom'];
    const defaultDrugs = [
        {name: "Ketamine", dose: 4.0, conc: 100, category: "Anaesthetic"},
        {name: "Xylazine", dose: 1.0, conc: 100, category: "Anaesthetic"},
        {name: "Medetomidine", dose: 0.05, conc: 1, category: "Anaesthetic"},
        {name: "Tiletamine-Zol", dose: 2.0, conc: 100, category: "Anaesthetic"},
        {name: "Atipamezole", dose: 0.25, conc: 5, category: "Reversal"}
    ];

    // Emergency/resuscitation drugs, sourced from WTHP (tiger-specific field
    // doses). Merged into any existing saved library below so current users
    // get these without losing their custom entries. Dual-range doses use
    // the WTHP midpoint or the safer starting dose — verify against vial
    // strength and patient before use; these are calculator presets, not a
    // substitute for clinical judgement.
    const emergencyDrugs = [
        {name: "Adrenaline 1:1000", dose: 0.01, conc: 1, category: "Emergency"},
        {name: "Atropine", dose: 0.04, conc: 0.6, category: "Emergency"},
        {name: "Glycopyrrolate", dose: 0.01, conc: 0.2, category: "Emergency"},
        {name: "Doxapram (Adult)", dose: 1.0, conc: 20, category: "Emergency"},
        {name: "Doxapram (Juvenile)", dose: 3.0, conc: 20, category: "Emergency"},
        {name: "Diazepam (Seizure)", dose: 0.1, conc: 5, category: "Emergency"},
        {name: "Dexamethasone (Shock)", dose: 1.0, conc: 2, category: "Emergency"},
        {name: "Dexamethasone (Anti-inflam)", dose: 0.1, conc: 2, category: "Emergency"}
    ];

    // One-time merge: add any emergencyDrugs entries not already present
    // (by name) into the saved library, without touching user edits/custom
    // drugs. Runs once, guarded by a flag, so it won't re-add a drug the
    // user deliberately deleted afterward.
    function mergeEmergencyDrugs() {
        if (localStorage.getItem('carnivore_drugs_emergency_merged_v1')) return;
        const existingNames = new Set(drugRepo.map(d => d.name));
        let added = false;
        emergencyDrugs.forEach(d => {
            if (!existingNames.has(d.name)) { drugRepo.push(d); added = true; }
        });
        if (added) safeSetItem('carnivore_drugs', JSON.stringify(drugRepo));
        localStorage.setItem('carnivore_drugs_emergency_merged_v1', '1');
    }

    // Curated antibiotics / analgesics / anti-parasitics for the calculator,
    // sourced in the Reference tab. Only single-dose or clearly injectable
    // items with a commonly-stocked concentration are included here — oral
    // multi-day regimens (tramadol, aspirin, most anti-parasitics) are
    // reference-only since "volume to inject" isn't the relevant number for
    // those. Concentrations reflect common formulation strengths — always
    // confirm against the actual vial label before dosing.
    const formularyDrugs = [
        {name: "Amoxicillin LA", dose: 15, conc: 150, category: "Antibiotic"},
        {name: "Cefovecin (Convenia)", dose: 8, conc: 80, category: "Antibiotic"},
        {name: "Enrofloxacin", dose: 5, conc: 100, category: "Antibiotic"},
        {name: "Meloxicam (peri-op)", dose: 0.2, conc: 5, category: "Analgesic"},
        {name: "Carprofen (peri-op)", dose: 4, conc: 50, category: "Analgesic"},
        {name: "Buprenorphine", dose: 0.02, conc: 0.3, category: "Analgesic"},
        {name: "Butorphanol", dose: 0.4, conc: 10, category: "Analgesic"},
        {name: "Ivermectin", dose: 0.2, conc: 10, category: "Anti-parasitic"}
    ];

    function mergeFormularyDrugs() {
        if (localStorage.getItem('carnivore_drugs_formulary_merged_v1')) return;
        const existingNames = new Set(drugRepo.map(d => d.name));
        let added = false;
        formularyDrugs.forEach(d => {
            if (!existingNames.has(d.name)) { drugRepo.push(d); added = true; }
        });
        if (added) safeSetItem('carnivore_drugs', JSON.stringify(drugRepo));
        localStorage.setItem('carnivore_drugs_formulary_merged_v1', '1');
    }

    // One-time migration: libraries saved before categories existed get a
    // best-effort category assigned by matching name against the known
    // lists above; anything unrecognized (the vet's own custom entries)
    // becomes "Custom" rather than being left ungrouped.
    function migrateDrugCategories() {
        if (localStorage.getItem('carnivore_drugs_categories_migrated_v1')) return;
        const known = {};
        [...defaultDrugs, ...emergencyDrugs, ...formularyDrugs].forEach(d => { known[d.name] = d.category; });
        let changed = false;
        drugRepo.forEach(d => {
            if (!d.category) { d.category = known[d.name] || 'Custom'; changed = true; }
        });
        if (changed) safeSetItem('carnivore_drugs', JSON.stringify(drugRepo));
        localStorage.setItem('carnivore_drugs_categories_migrated_v1', '1');
    }

    // Follow-up correction for libraries migrated before "Reversal" existed
    // as its own category — Atipamezole was folded into "Anaesthetic" at
    // the time. Re-tags it without touching anything the vet edited.
    function migrateReversalCategory() {
        if (localStorage.getItem('carnivore_drugs_reversal_recat_v1')) return;
        let changed = false;
        drugRepo.forEach(d => {
            if (d.name === 'Atipamezole' && d.category === 'Anaesthetic') { d.category = 'Reversal'; changed = true; }
        });
        if (changed) safeSetItem('carnivore_drugs', JSON.stringify(drugRepo));
        localStorage.setItem('carnivore_drugs_reversal_recat_v1', '1');
    }

    function loadDrugRepo() {
        const saved = safeParse('carnivore_drugs', null);
        if(saved) drugRepo = saved;
        else { drugRepo = defaultDrugs; safeSetItem('carnivore_drugs', JSON.stringify(drugRepo)); }
        mergeEmergencyDrugs();
        mergeFormularyDrugs();
        migrateDrugCategories();
        migrateReversalCategory();
        renderRepoList();
    }

    function saveDrugToRepo() {
        const n = document.getElementById('new_drug_name').value.trim();
        const d = parseFloat(document.getElementById('new_drug_dose').value);
        const c = parseFloat(document.getElementById('new_drug_conc').value);
        const cat = document.getElementById('new_drug_category').value || 'Custom';
        if(!n || !isFinite(d) || d<=0 || !isFinite(c) || c<=0) { alert("Enter a drug name and a dose and concentration greater than 0."); return; }
        const prevRepo = drugRepo.slice();
        drugRepo.push({name:n, dose:d, conc:c, category:cat});
        if (!safeSetItem('carnivore_drugs', JSON.stringify(drugRepo))) { drugRepo = prevRepo; return; }
        renderRepoList();
        document.getElementById('new_drug_name').value='';
        document.getElementById('new_drug_dose').value='';
        document.getElementById('new_drug_conc').value='';
        document.getElementById('new_drug_category').value='Custom';
        alert("Drug Added");
    }

    function deleteDrugFromRepo(i) {
        if(!confirm("Remove from Library?")) return;
        const prevRepo = drugRepo.slice();
        drugRepo.splice(i, 1);
        if (!safeSetItem('carnivore_drugs', JSON.stringify(drugRepo))) { drugRepo = prevRepo; return; }
        if (editingDrugIndex === i) editingDrugIndex = -1;
        renderRepoList();
    }

    // --- EDIT IN PLACE ---
    // Only one row editable at a time; index into drugRepo (stable while
    // editing since we don't reorder/remove rows mid-edit).
    let editingDrugIndex = -1;

    function startEditDrug(i) {
        editingDrugIndex = i;
        renderRepoList();
    }

    function cancelEditDrug() {
        editingDrugIndex = -1;
        renderRepoList();
    }

    function saveEditDrug(i) {
        const row = document.querySelector(`#repoList tr[data-idx="${i}"]`);
        if (!row) return;
        const n = row.querySelector('.edit-name').value.trim();
        const d = parseFloat(row.querySelector('.edit-dose').value);
        const c = parseFloat(row.querySelector('.edit-conc').value);
        const cat = row.querySelector('.edit-category').value || 'Custom';
        if(!n || !isFinite(d) || d<=0 || !isFinite(c) || c<=0) { alert("Enter a drug name and a dose and concentration greater than 0."); return; }
        const prevRepo = drugRepo.slice();
        drugRepo[i] = { name: n, dose: d, conc: c, category: cat };
        if (!safeSetItem('carnivore_drugs', JSON.stringify(drugRepo))) { drugRepo = prevRepo; return; }
        editingDrugIndex = -1;
        renderRepoList();
    }

    // --- SEARCH / FILTER ---
    let drugFilterQuery = '';
    function filterDrugRepo(q) { drugFilterQuery = (q || '').trim().toLowerCase(); renderRepoList(); }

    function categoryOptionsHtml(selected) {
        return DRUG_CATEGORIES.map(c => `<option value="${c}" ${c===selected?'selected':''}>${c}</option>`).join('');
    }

    function renderRepoList() {
        refreshRevDrugPicker();
        const div = document.getElementById('repoList');
        div.innerHTML = "";
        if(drugRepo.length === 0) { div.innerHTML = "No custom drugs."; return; }
        const tbl = document.createElement('table');
        tbl.innerHTML = `<thead><tr><th>Name</th><th>mg/kg</th><th>mg/ml</th><th></th></tr></thead><tbody></tbody>`;
        const tbody = tbl.querySelector('tbody');
        let shown = 0;
        drugRepo.forEach((d, i) => {
            const cat = d.category || 'Custom';
            if (drugFilterQuery && editingDrugIndex !== i &&
                !d.name.toLowerCase().includes(drugFilterQuery) &&
                !cat.toLowerCase().includes(drugFilterQuery)) return;
            shown++;
            const tr = document.createElement('tr');
            tr.setAttribute('data-idx', i);
            if (editingDrugIndex === i) {
                tr.innerHTML = `<td><input type="text" class="log-input edit-name" value="${escapeHtml(d.name)}" style="text-align:left; margin-bottom:4px;">` +
                    `<select class="log-input edit-category" style="font-size:0.75rem;">${categoryOptionsHtml(cat)}</select></td>` +
                    `<td><input type="number" step="any" class="log-input edit-dose" value="${escapeHtml(d.dose)}"></td>` +
                    `<td><input type="number" step="any" class="log-input edit-conc" value="${escapeHtml(d.conc)}"></td>` +
                    `<td style="white-space:nowrap;">` +
                    `<button class="btn-sm" aria-label="Save changes to ${escapeHtml(d.name)}" style="color:var(--primary);border:none;" onclick="saveEditDrug(${i})">✓</button>` +
                    `<button class="btn-sm" aria-label="Cancel editing" style="color:#888;border:none;" onclick="cancelEditDrug()">✕</button>` +
                    `</td>`;
            } else {
                tr.innerHTML = `<td>${escapeHtml(d.name)}<br><span class="cat-chip">${escapeHtml(cat)}</span></td><td>${escapeHtml(d.dose)}</td><td>${escapeHtml(d.conc)}</td>` +
                    `<td style="white-space:nowrap;">` +
                    `<button class="btn-sm" aria-label="Edit ${escapeHtml(d.name)}" style="color:var(--blue);border:none;" onclick="startEditDrug(${i})">✎</button>` +
                    `<button class="btn-sm" aria-label="Remove ${escapeHtml(d.name)} from library" style="color:red;border:none;" onclick="deleteDrugFromRepo(${i})">X</button>` +
                    `</td>`;
            }
            tbody.appendChild(tr);
        });
        if (shown === 0) { div.innerHTML = "No drugs match your search."; return; }
        div.appendChild(tbl);
    }

    // --- CALCULATOR ---
    function addDrugRow(name="", dose="", conc="") {
        const id = 'r'+Date.now();
        const opts = buildDrugOptionsHtml();
        createRow('calcTable', `<td id="${id}"><select class="log-input" style="text-align:left; font-weight:bold; color:var(--primary);" onchange="fillDrugRow(this)">${opts}</select><input type="text" class="log-input calc-name-custom" placeholder="Or type custom" value="${escapeHtml(name)}" style="font-size:0.8rem; margin-top:2px;"></td><td><input type="number" class="c-dose log-input" value="${escapeHtml(dose)}" oninput="recalcAll()"></td><td><input type="number" class="c-conc log-input" value="${escapeHtml(conc)}" oninput="recalcAll()"></td><td class="c-vol" style="font-weight:bold; color:var(--primary); text-align:center;">0.0</td><td onclick="document.getElementById('${id}').parentElement.remove(); recalcAll();" style="color:red; font-weight:bold; cursor:pointer;">X</td>`);
    }

    // Groups the drug picker by category (Anaesthetic/Emergency/Antibiotic/
    // Analgesic/Anti-parasitic/Custom) via <optgroup> so the list stays fast
    // to scan under time pressure as the library grows. Option values stay
    // as the original drugRepo index regardless of grouping.
    function buildDrugOptionsHtml() {
        let opts = `<option value="">Select Drug...</option>`;
        DRUG_CATEGORIES.forEach(cat => {
            const inCat = drugRepo.map((d, i) => ({d, i})).filter(x => (x.d.category || 'Custom') === cat);
            if (inCat.length === 0) return;
            opts += `<optgroup label="${escapeHtml(cat)}">`;
            inCat.forEach(x => { opts += `<option value="${x.i}">${escapeHtml(x.d.name)}</option>`; });
            opts += `</optgroup>`;
        });
        return opts;
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

    // --- REVIVAL DRUG PICKER ---
    // rev_drug_picker offers the current drug library (any category — a
    // reversal doesn't have to be the built-in Atipamezole entry); picking
    // one fills the free-text rev_drug field, which stays the field that's
    // actually saved/exported so a vet can still type something not in the
    // library. Refreshed from renderRepoList() whenever the library changes.
    function refreshRevDrugPicker() {
        const picker = document.getElementById('rev_drug_picker');
        if (!picker) return;
        picker.innerHTML = buildDrugOptionsHtml();
    }
    function fillRevDrug(selectEl) {
        const idx = selectEl.value;
        if (idx === "") return;
        const drug = drugRepo[idx];
        if (drug) { document.getElementById('rev_drug').value = drug.name; autoSave(); }
    }

    // --- TOP-UP DRUG PICKER ---
    // Same pattern as the Calculator's drug rows: a grouped select fills a
    // free-text field so top-ups can either be picked from the library or
    // typed. tu-drug (not the picker) is the field that gets saved/exported.
    function fillTopupDrug(selectEl) {
        const idx = selectEl.value;
        if (idx === "") return;
        const drug = drugRepo[idx];
        const tr = selectEl.closest('tr');
        if (drug && tr) tr.querySelector('.tu-drug').value = drug.name;
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
                const lat = p.coords.latitude, lon = p.coords.longitude;
                if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
                    s.innerText = "GPS returned an invalid fix. Try again."; t.innerText = "Retry GPS"; s.style.color = "red";
                    return;
                }
                document.getElementById('gps_n').value = lat.toFixed(6);
                document.getElementById('gps_e').value = lon.toFixed(6);
                s.innerText = `Accuracy: ${p.coords.accuracy.toFixed(1)}m`; t.innerText="Update GPS"; s.style.color="green"; autoSave();
            }, 
            e => { s.innerText="GPS Failed."; t.innerText="Retry GPS"; s.style.color="red"; },
            { enableHighAccuracy: true, timeout: CONFIG.GPS_TIMEOUT_MS, maximumAge: 0 }
        );
    }

    const ids = ['date','time','gps_n','gps_e','species','animal_id','animal_sex','animal_age','body_condition','anaesthesia_risk','reason_immob','veterinarians','weight_est','weight_act','time_dart','time_down','rev_drug','rev_route','time_rev','time_headup','time_standing','rel_notes','m_total_len','m_shoulder','m_chest','m_neck','m_head_circ','m_paw_fore','m_paw_hind','m_paw_fore_len','m_paw_hind_len','m_canine_ul','m_canine_ur','m_canine_ll','m_canine_lr','m_icd_up','m_icd_low'];
    
    function createRow(tableId, html) { const row = document.createElement('tr'); row.innerHTML=html; document.querySelector(`#${tableId} tbody`).appendChild(row); }
    
    // --- FUNCTIONAL IMPROVEMENT: LOG DELETION ---
    function addLogStep(v=null) { 
        const t = v?v[0]:new Date().toTimeString().substr(0,5); 
        createRow('logTable', `<td><input type="time" class="log-input" value="${escapeHtml(t)}"></td><td><input type="number" class="log-input" value="${escapeHtml(v?v[1]:'')}"></td><td><input type="number" class="log-input" value="${escapeHtml(v?v[2]:'')}"></td><td><input type="number" class="log-input" value="${escapeHtml(v?v[3]:'')}"></td><td><input type="text" class="log-input" value="${escapeHtml(v?v[4]:'')}"></td><td onclick="this.parentElement.remove()" style="color:red; font-weight:bold; cursor:pointer;" role="button" aria-label="Remove this reading">X</td>`); 
    }
    
    // --- FUNCTIONAL IMPROVEMENT: TOPUP DELETION ---
    function addTopupRow(v=null) { 
        const t = v?v[0]:new Date().toTimeString().substr(0,5); 
        const sel = v?v[3]:'IV'; 
        const opts = buildDrugOptionsHtml();
        createRow('topupTable', `<td><input type="time" class="log-input tu-time" value="${escapeHtml(t)}"></td><td><select class="log-input tu-picker" onchange="fillTopupDrug(this)">${opts}</select><input type="text" class="log-input tu-drug" placeholder="Or type custom" value="${escapeHtml(v?v[1]:'')}" style="font-size:0.8rem; margin-top:2px;"></td><td><input type="number" class="log-input tu-mg" placeholder="mg" value="${escapeHtml(v?v[2]:'')}"></td><td><select class="log-input tu-route"><option ${sel=='IV'?'selected':''}>IV</option><option ${sel=='IM'?'selected':''}>IM</option></select></td><td onclick="this.parentElement.remove()" style="color:red; font-weight:bold; cursor:pointer;" role="button" aria-label="Remove this dose">X</td>`); 
    }

    // Records are keyed by a unique recordId, never by animal ID — an
    // animal can be legitimately recaptured/re-immobilized many times
    // (health checks, collar swaps, translocations) and each event is a
    // distinct case that must not overwrite the last one.
    function saveToHistory() {
        const id = document.getElementById('animal_id').value || "Unknown";
        let rec = {recordId: 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2,8), id:id, date: document.getElementById('date').value, species: document.getElementById('species').value, logs:[], topups:[]};
        ids.forEach(k=>{ if(document.getElementById(k)) rec[k] = document.getElementById(k).value; });
        // Logs and Topups are saved with only the original 5/4 data fields, excluding the 'X' column.
        document.querySelectorAll('#logTable tbody tr').forEach(r=>{ 
            let d=[]; 
            r.querySelectorAll('input:not([type="time"]), input[type="time"]').forEach(i=>d.push(i.value)); 
            rec.logs.push(d.slice(0, 5)); 
        });
        document.querySelectorAll('#topupTable tbody tr').forEach(r=>{ 
            rec.topups.push([
                r.querySelector('.tu-time').value,
                r.querySelector('.tu-drug').value,
                r.querySelector('.tu-mg').value,
                r.querySelector('.tu-route').value
            ]);
        });
        let h = safeParse('carnivore_db', []);
        // Only offer to overwrite when it's the exact same in-progress case
        // (same animal ID + same date) that was already saved this session —
        // never for an older case just because the ID matches.
        const dupIdx = h.findIndex(x => x.id === id && x.date === rec.date);
        if (dupIdx !== -1) {
            if (!confirm(`A record for "${id}" on ${rec.date} already exists. Overwrite it? (Cancel keeps both as separate records.)`)) {
                h.unshift(rec);
            } else {
                h[dupIdx] = rec;
            }
        } else {
            h.unshift(rec);
        }
        if (!safeSetItem('carnivore_db', JSON.stringify(h))) return;
        alert("Saved to History!"); renderHistory();
        // Cloud Sync (optional, never blocks the local save above). See
        // sync.js — this is a no-op until Cloud Sync is configured and
        // the user is signed in.
        try { if (window.CarnCalSync && window.CarnCalSync.saveCase) window.CarnCalSync.saveCase(rec); } catch (e) { console.warn('[CarnCal Sync] skipped:', e); }
    }
    
    // --- SEARCH / FILTER ---
    let histFilterQuery = '';
    function filterHistory(q) { histFilterQuery = (q || '').trim().toLowerCase(); renderHistory(); }

    function renderHistory() {
        const l = document.getElementById('historyList'); l.innerHTML=""; const h = safeParse('carnivore_db', []);
        if(h.length===0) { l.innerHTML="<div style='text-align:center; padding:20px; color:#aaa;'>No records</div>"; return; }
        let shown = 0;
        h.forEach((r,i)=>{
            if (histFilterQuery && !(String(r.id||'').toLowerCase().includes(histFilterQuery) || String(r.species||'').toLowerCase().includes(histFilterQuery))) return;
            shown++;
            const d=document.createElement('div');
            d.style.cssText="padding:15px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;";
            d.innerHTML = `<div><strong>${escapeHtml(r.id)}</strong> <span style="font-size:0.8rem; background:#eee; padding:2px 6px; border-radius:4px;">${escapeHtml(r.species)}</span><br><small style="color:#888">${escapeHtml(r.date)}</small></div><div><button class="btn-outline" aria-label="Load record for ${escapeHtml(r.id)}" style="display:inline; width:auto; padding:5px 10px; margin-right:5px;" onclick="loadRec(${i})">Load</button><button class="btn-sm" aria-label="Delete record for ${escapeHtml(r.id)}" style="color:red; border:none; background:#ffebee;" onclick="delRec(${i})">X</button></div>`;
            l.appendChild(d);
        });
        if (shown === 0) l.innerHTML = "<div style='text-align:center; padding:20px; color:#aaa;'>No matching records</div>";
    }
    
    function loadRec(i) {
        const r = safeParse('carnivore_db', [])[i];
        if (!r) { alert("Record not found."); return; }
        ids.forEach(k=>{ if(document.getElementById(k)) document.getElementById(k).value=r[k]||""; });
        document.querySelector('#logTable tbody').innerHTML=""; (r.logs||[]).forEach(l=>addLogStep(l)); document.querySelector('#topupTable tbody').innerHTML=""; (r.topups||[]).forEach(l=>addTopupRow(l)); updateWeightBadge(); switchTab('tab-case');
    }
    function delRec(i) { if(!confirm("Delete?")) return; let h = safeParse('carnivore_db', []); h.splice(i,1); if (!safeSetItem('carnivore_db', JSON.stringify(h))) return; renderHistory(); }

    function exportCSV() {
        let c = "Field,Value\n"; ids.forEach(k=>{ const el=document.getElementById(k); if(el) c+=`${csvEscape(k)},${csvEscape(el.value)}\n`; });
        c+="\nMONITORING LOGS\nTime,HR,RR,SpO2,Note\n"; document.querySelectorAll('#logTable tbody tr').forEach(r=>{ 
            let l=[]; 
            r.querySelectorAll('input:not([type="time"]), input[type="time"]').forEach(i=>l.push(i.value)); 
            c+=l.slice(0, 5).map(csvEscape).join(',')+"\n"; 
        });
        c+="\nTOP-UP DOSES\nTime,Drug,mg,Route\n"; document.querySelectorAll('#topupTable tbody tr').forEach(r=>{ 
            const l = [r.querySelector('.tu-time').value, r.querySelector('.tu-drug').value, r.querySelector('.tu-mg').value, r.querySelector('.tu-route').value];
            c+=l.map(csvEscape).join(',')+"\n"; 
        });
        const b = new Blob([c],{type:'text/csv'}); const a = document.createElement('a'); a.href=URL.createObjectURL(b); a.download=(document.getElementById('animal_id').value||"data")+".csv"; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
    function clearForm() { if(confirm("Clear Form?")) { document.querySelectorAll('input').forEach(i=>i.value=""); document.querySelector('#logTable tbody').innerHTML=""; document.querySelector('#topupTable tbody').innerHTML=""; document.getElementById('date').valueAsDate = new Date(); addLogStep(); document.querySelector('#calcTable tbody').innerHTML=""; addDrugRow(); updateWeightBadge(); } }
    
    function val(id) { const el = document.getElementById(id); return escapeHtml(el ? el.value : ''); }

    function downloadBackup() {
        const backup = { history: safeParse('carnivore_db', []), drugs: safeParse('carnivore_drugs', []), date: new Date().toISOString() };
        const blob = new Blob([JSON.stringify(backup, null, 2)], {type: 'application/json'});
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = "CarnCal_Backup_" + new Date().toISOString().slice(0,10) + ".json"; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }

    // Validates shape before touching storage — rejects a file that isn't
    // actually a CarnCal backup rather than trusting arbitrary JSON.
    function isValidBackup(data) {
        if (!data || typeof data !== 'object') return false;
        if (!Array.isArray(data.history) || !Array.isArray(data.drugs)) return false;
        const recOk = data.history.every(r => r && typeof r === 'object' && typeof r.id === 'string');
        const drugOk = data.drugs.every(d => d && typeof d.name === 'string' && isFinite(d.dose) && isFinite(d.conc));
        return recOk && drugOk;
    }

    function restoreBackup(input) {
        const file = input.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = JSON.parse(e.target.result);
                if (isValidBackup(data)) {
                    if(confirm(`Restore ${data.history.length} records? This replaces everything currently on this device.`)) {
                        if (!safeSetItem('carnivore_db', JSON.stringify(data.history))) return;
                        if (!safeSetItem('carnivore_drugs', JSON.stringify(data.drugs))) return;
                        alert("Restored!"); location.reload();
                    }
                } else { alert("Invalid or corrupted backup file — nothing was restored."); }
            } catch (err) { alert("Error parsing file — nothing was restored."); }
        }; reader.readAsText(file);
        input.value = '';
    }

    function checkStorageUsage() {
        let total = 0; for (let x in localStorage) { if (localStorage.hasOwnProperty(x)) total += ((localStorage[x].length * 2) / 1024 / 1024); }
        if (total > CONFIG.STORAGE_WARN_MB) alert(`Warning: App storage > ${CONFIG.STORAGE_WARN_MB}MB. Download a backup and consider clearing old records.`);
    }

    // --- REFERENCE TAB SEARCH ---
    // Filters rows across every table on the Reference tab by plain-text
    // match, and hides a whole card if nothing in it matches — keeps the
    // ~40-row reference list fast to scan under time pressure.
    function filterReferenceTables(query) {
        const q = (query || '').trim().toLowerCase();
        document.querySelectorAll('#tab-ref .card').forEach(card => {
            const table = card.querySelector('table');
            if (!table) return; // the search box's own card has no table
            const rows = Array.from(table.querySelectorAll('tr')).slice(1); // skip header row
            let anyVisible = false;
            rows.forEach(r => {
                const match = !q || r.textContent.toLowerCase().includes(q);
                r.style.display = match ? '' : 'none';
                if (match) anyVisible = true;
            });
            card.style.display = (q && !anyVisible) ? 'none' : '';
        });
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
            const drugName = escapeHtml(r.querySelector('.tu-drug').value);
            if(drugName) html+=`<tr><td>${escapeHtml(r.querySelector('.tu-time').value)}</td><td>${drugName}</td><td>${escapeHtml(r.querySelector('.tu-mg').value)}</td><td>${escapeHtml(r.querySelector('.tu-route').value)}</td></tr>`; 
        });
        html+=`</tbody></table></div>
        <div class="p-section"><div class="p-sec-title">IV. Monitoring Log</div><table class="p-table"><thead><tr><th>Time</th><th>HR</th><th>RR</th><th>SpO2</th><th>Notes</th></tr></thead><tbody>`;
        document.querySelectorAll('#logTable tbody tr').forEach(r=>{ 
            let d=[]; 
            r.querySelectorAll('input:not([type="time"]), input[type="time"]').forEach(i=>d.push(escapeHtml(i.value))); 
            if(d[0]) html+=`<tr><td>${d[0]}</td><td>${d[1]}</td><td>${d[2]}</td><td>${d[3]}</td><td>${d[4]}</td></tr>`; 
        });
        html+=`</tbody></table></div>
        <div class="p-section"><div class="p-sec-title">V. Revival &amp; Release</div>
        <div class="p-grid"><div class="p-row"><span class="p-label">Reversal Drug:</span> <span class="p-val">${val('rev_drug')}</span></div><div class="p-row"><span class="p-label">Route:</span> <span class="p-val">${val('rev_route')}</span></div></div>
        <div class="p-grid"><div class="p-row"><span class="p-label">Given At:</span> <span class="p-val">${val('time_rev')}</span></div><div class="p-row"><span class="p-label">Head Up:</span> <span class="p-val">${val('time_headup')}</span></div></div>
        <div class="p-grid"><div class="p-row"><span class="p-label">Standing:</span> <span class="p-val">${val('time_standing')}</span></div><div class="p-row"><span class="p-label">Release Site:</span> <span class="p-val">${val('rel_notes')}</span></div></div>
        </div>
        <div class="p-section"><div class="p-sec-title">VI. Morphometry (cm)</div>
        <div class="p-grid"><div class="p-row"><span class="p-label">Total Len:</span> <span class="p-val">${val('m_total_len')}</span></div><div class="p-row"><span class="p-label">Shoulder:</span> <span class="p-val">${val('m_shoulder')}</span></div></div>
        <div class="p-grid"><div class="p-row"><span class="p-label">Chest:</span> <span class="p-val">${val('m_chest')}</span></div><div class="p-row"><span class="p-label">Neck:</span> <span class="p-val">${val('m_neck')}</span></div></div>
        <div class="p-grid"><div class="p-row"><span class="p-label">Head Circ:</span> <span class="p-val">${val('m_head_circ')}</span></div><div class="p-row"><span class="p-label">Paw W (Fore/Hind):</span> <span class="p-val">${val('m_paw_fore')} / ${val('m_paw_hind')}</span></div></div>
        <div class="p-grid"><div class="p-row"><span class="p-label">Paw L (Fore/Hind):</span> <span class="p-val">${val('m_paw_fore_len')} / ${val('m_paw_hind_len')}</span></div><div class="p-row"><span class="p-label">Canine Upper (L/R):</span> <span class="p-val">${val('m_canine_ul')} / ${val('m_canine_ur')}</span></div></div>
        <div class="p-grid"><div class="p-row"><span class="p-label">Canine Lower (L/R):</span> <span class="p-val">${val('m_canine_ll')} / ${val('m_canine_lr')}</span></div><div class="p-row"><span class="p-label">Inter-Canine Dist (Up/Low):</span> <span class="p-val">${val('m_icd_up')} / ${val('m_icd_low')}</span></div></div>
        </div>`;
        c.innerHTML = html; window.print();
    }

    // --- CONNECTIVITY BADGE ---
    // Reassures field users the app is running correctly with no signal,
    // and that a "no connection" state is expected, not a fault.
    function updateNetStatus() {
        const badge = document.getElementById('netStatus');
        if (!badge) return;
        if (navigator.onLine) {
            badge.textContent = 'Online';
            badge.className = 'net-badge online';
        } else {
            badge.textContent = 'Offline';
            badge.className = 'net-badge offline';
        }
    }
    window.addEventListener('online', updateNetStatus);
    window.addEventListener('offline', updateNetStatus);
    updateNetStatus();

    // --- SERVICE WORKER REGISTRATION (OFFLINE SUPPORT) ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => {
                    console.log('Service Worker registered');
                    // If a new SW takes control (after activate/clients.claim in
                    // an update), reload once so the user gets the fresh assets
                    // instead of being stuck between old cached JS/HTML.
                    let refreshed = false;
                    navigator.serviceWorker.addEventListener('controllerchange', () => {
                        if (refreshed) return;
                        refreshed = true;
                        location.reload();
                    });
                })
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
    updateWeightBadge();
    document.getElementById('appVersion').textContent = 'CarnCal v' + APP_VERSION;
