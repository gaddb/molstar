/**
 * Copyright (c) 2021 mol* contributors, licensed under MIT, See LICENSE file for more info.
 * 
 * Modified to add Export to AR feature with GitHub Actions upload.
 * 
 * @author Sukolsak Sakshuwong <sukolsak@stanford.edu>
 * @author Assisted by ChatGPT (2024)
 */

import { merge } from 'rxjs';
import { CollapsableControls, CollapsableState } from '../../mol-plugin-ui/base';
import { Button } from '../../mol-plugin-ui/controls/common';
import { GetAppSvg, CubeSendSvg } from '../../mol-plugin-ui/controls/icons';
import { ParameterControls } from '../../mol-plugin-ui/controls/parameters';
import { download } from '../../mol-util/download';
import { GeometryParams, GeometryControls } from './controls';
import QRCode from 'qrcode';

// ✅ Render Uploader URL
const UPLOADER_API_URL = "https://molstar-uploader.onrender.com/upload";

interface State {
    busy?: boolean
}

export class GeometryExporterUI extends CollapsableControls<{}, State> {
    private _controls: GeometryControls | undefined;

    get controls() {
        return this._controls || (this._controls = new GeometryControls(this.plugin));
    }

    protected defaultState(): State & CollapsableState {
        return {
            header: 'Export Geometry',
            isCollapsed: true,
            brand: { accent: 'cyan', svg: CubeSendSvg }
        };
    }

    protected renderControls(): JSX.Element {
        const ctrl = this.controls;
        return <>
            <ParameterControls
                params={GeometryParams}
                values={ctrl.behaviors.params.value}
                onChangeValues={xs => ctrl.behaviors.params.next(xs)}
                isDisabled={this.state.busy}
            />
            <Button icon={GetAppSvg}
                onClick={this.save} style={{ marginTop: 1 }}
                disabled={this.state.busy || !this.plugin.canvas3d?.reprCount.value}>
                Save
            </Button>

            <Button icon={CubeSendSvg}
                onClick={this.exportToAR} style={{ marginTop: 1 }}
                disabled={this.state.busy || !this.plugin.canvas3d?.reprCount.value}>
                Export to AR
            </Button>
        </>;
    }

    componentDidMount() {
        if (!this.plugin.canvas3d) return;

        const merged = merge(
            this.controls.behaviors.params,
            this.plugin.canvas3d.reprCount
        );

        this.subscribe(merged, () => {
            if (!this.state.isCollapsed) this.forceUpdate();
        });
    }

    componentWillUnmount() {
        super.componentWillUnmount();
        this._controls?.dispose();
        this._controls = void 0;
    }

    save = async () => {
        try {
            this.setState({ busy: true });
            const data = await this.controls.exportGeometry();
            download(data.blob, data.filename);
        } catch (e) {
            console.error(e);
        } finally {
            this.setState({ busy: false });
        }
    };

    exportToAR = async () => {
        try {
            this.setState({ busy: true });

            const data = await this.controls.exportGeometry();
            const pdbId = this.plugin.managers.structure.hierarchy.current.structures[0]?.cell.obj?.data?.model?.entryId || 'Unknown';

            // ✅ Generate a unique filename with timestamp & random string
            const timestamp = new Date().toISOString().replace(/[:.-]/g, '');
            const randomId = Math.random().toString(36).substring(2, 8);
            const glbFilename = `${pdbId}-${timestamp}-${randomId}.glb`;
            const usdzFilename = `${pdbId}-${timestamp}-${randomId}.usdz`;

            // ✅ Convert GLB to File object
            const glbFile = new File([data.blob], glbFilename, { type: 'model/gltf-binary' });

            // ✅ Placeholder USDZ file (Mol* does not export USDZ natively)
            const usdzFile = new File([data.blob], usdzFilename, { type: 'model/vnd.usdz+zip' });

            // ✅ Debug Logs (Print to Console)
            console.log("🚀 Uploading Model via Render Service:");
            console.log("PDB ID:", pdbId);
            console.log("GLB Filename:", glbFilename);
            console.log("USDZ Filename:", usdzFilename);

            // ✅ Prepare multipart/form-data payload
            const formData = new FormData();
            formData.append("pdbId", pdbId);
            formData.append("glb", glbFile);
            formData.append("usdz", usdzFile);

            // ✅ Send Upload Request
            const response = await fetch(UPLOADER_API_URL, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Upload failed with status ${response.status}`);
            }

            const result = await response.json();
            console.log("✅ Upload successful:", result);

            // ✅ Generate QR Code for the AR link
            const qrCodeUrl = await QRCode.toDataURL(result.arLink);

            // ✅ Show Popup with Live Link & QR Code
            const popup = document.createElement('div');
            popup.style.position = 'fixed';
            popup.style.top = '50%';
            popup.style.left = '50%';
            popup.style.transform = 'translate(-50%, -50%)';
            popup.style.backgroundColor = 'white';
            popup.style.padding = '20px';
            popup.style.zIndex = '9999';
            popup.style.border = '1px solid #ccc';

            popup.innerHTML = `
                <p>Export Complete! Click the link below or scan the QR code to view your model in AR:</p>
                <p><a href="${result.arLink}" target="_blank">${result.arLink}</a></p>
                <img src="${qrCodeUrl}" alt="QR Code" style="width: 200px; height: 200px;">
                <button onclick="document.body.removeChild(this.parentNode)">Close</button>
            `;

            document.body.appendChild(popup);

        } catch (e) {
            console.error(e);
            alert('Export to AR failed.');
        } finally {
            this.setState({ busy: false });
        }
    };
}
