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

// ✅ Hardcoded GitHub API URL (Authentication is handled by GitHub Actions)
const GITHUB_API_URL = "https://api.github.com/repos/gaddb/protein-ar-viewer/dispatches";

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

            // ✅ Convert blobs to Base64
            const glbBase64 = await blobToBase64(data.blob);
            const usdzBase64 = await blobToBase64(data.blob); // Mol* does not export USDZ natively, placeholder

            // ✅ Debug Logs (Print to Console)
            console.log("🚀 Uploading Model to GitHub:");
            console.log("PDB ID:", pdbId);
            console.log("GLB Filename:", glbFilename);
            console.log("USDZ Filename:", usdzFilename);
            console.log("GLB Base64 (first 100 chars):", glbBase64.substring(0, 100) + "...");
            console.log("USDZ Base64 (first 100 chars):", usdzBase64.substring(0, 100) + "...");

            // ✅ Send Upload Request to GitHub Actions
            const response = await fetch(GITHUB_API_URL, {
                method: 'POST',
                headers: {
                    'Accept': 'application/vnd.github.everest-preview+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    event_type: 'upload_model',  // ✅ MATCHING EVENT TYPE!
                    client_payload: {
                        glb: glbBase64,
                        usdz: usdzBase64,
                        pdbId: pdbId
                    }
                })
            });

            if (!response.ok) throw new Error('Failed to trigger upload action');

            // ✅ Generate the AR model URL
            const modelUrl = `https://gaddb.github.io/protein-ar-viewer/model.html?glb=${glbFilename}&usdz=${usdzFilename}`;

            // ✅ Generate QR Code
            const qrCodeUrl = await QRCode.toDataURL(modelUrl);

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
                <p><a href="${modelUrl}" target="_blank">${modelUrl}</a></p>
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

// ✅ Convert Blob to Base64 (Used for GitHub Action Upload)
async function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
