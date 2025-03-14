/**
 * Copyright (c) 2021 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Sukolsak Sakshuwong <sukolsak@stanford.edu>
 * @modified Assisted by ChatGPT (2024) - Added Export to AR feature with Render proxy for GitHub authentication.
 */

import * as React from 'react';
import { PluginContext } from 'molstar/lib/mol-plugin/context';
import { StructureHierarchyManager } from 'molstar/lib/mol-plugin-state/manager/structure/hierarchy';
import { createGlbExporter } from 'molstar/lib/extensions/model-export/formats/glb';
import { createUsdzExporter } from 'molstar/lib/extensions/model-export/formats/usdz';
import QRCode from 'qrcode';
import { merge } from 'rxjs';
import { CollapsableControls, CollapsableState } from '../../mol-plugin-ui/base';
import { Button } from '../../mol-plugin-ui/controls/common';
import { GetAppSvg, CubeScanSvg, CubeSendSvg } from '../../mol-plugin-ui/controls/icons';
import { ParameterControls } from '../../mol-plugin-ui/controls/parameters';
import { download } from '../../mol-util/download';
import { GeometryParams, GeometryControls } from './controls';

// ✅ Your Render proxy URL (this sends models securely to your GitHub repo)
const UPLOAD_PROXY_URL = "https://molstar-uploader.onrender.com/upload";

interface State {
    busy?: boolean
}

export class GeometryExporterUI extends CollapsableControls<{}, State> {
    private _controls: GeometryControls | undefined;
    private isARSupported: boolean | undefined;

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
        if (this.isARSupported === undefined) {
            this.isARSupported = !!document.createElement('a').relList?.supports?.('ar');
        }
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
            {this.isARSupported && ctrl.behaviors.params.value.format === 'usdz' &&
                <Button icon={CubeScanSvg}
                    onClick={this.viewInAR} style={{ marginTop: 1 }}
                    disabled={this.state.busy || !this.plugin.canvas3d?.reprCount.value}>
                    View in AR
                </Button>
            }
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
            this.plugin.canvas3d!.reprCount
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

    viewInAR = async () => {
        try {
            this.setState({ busy: true });
            const data = await this.controls.exportGeometry();
            const a = document.createElement('a');
            a.rel = 'ar';
            a.href = URL.createObjectURL(data.blob);
            a.appendChild(document.createElement('img'));
            setTimeout(() => URL.revokeObjectURL(a.href), 4E4); // 40s
            setTimeout(() => a.dispatchEvent(new MouseEvent('click')));
        } catch (e) {
            console.error(e);
        } finally {
            this.setState({ busy: false });
        }
    };

    exportToAR = async () => {
        try {
            this.setState({ busy: true });

            const plugin = this.plugin;
            const structures = StructureHierarchyManager.getStructures(plugin);
            if (structures.length === 0) {
                alert('No structure loaded!');
                return;
            }

            // ✅ Generate unique filenames with timestamp & random ID
            const pdbId = structures[0].cell.obj?.data.models[0]?.entryId || 'unknown';
            const timestamp = new Date().toISOString().replace(/[:.-]/g, '');
            const randomString = Math.random().toString(36).slice(2, 8);
            const glbFilename = `${pdbId}-${timestamp}-${randomString}.glb`;
            const usdzFilename = `${pdbId}-${timestamp}-${randomString}.usdz`;

            console.log("🔄 Generating GLB model...");
            const glbExporter = createGlbExporter(plugin);
            const glbBlob = await glbExporter.export(plugin);
            const glbBase64 = await blobToBase64(glbBlob);

            console.log("🔄 Generating USDZ model...");
            const usdzExporter = createUsdzExporter(plugin);
            const usdzBlob = await usdzExporter.export(plugin);
            const usdzBase64 = await blobToBase64(usdzBlob);

            console.log("⬆️ Uploading Model via Proxy Service...");
            const response = await fetch(UPLOAD_PROXY_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pdbId, glb: glbBase64, usdz: usdzBase64 }),
            });

            const result = await response.json();
            if (result.success) {
                console.log("✅ Upload successful:", result.arLink);
                this.showPopup(result.arLink, result.qrCodeUrl);
            } else {
                throw new Error(result.error || "Upload failed.");
            }
        } catch (error) {
            console.error("❌ Export failed:", error);
            alert("Export failed. Check console for details.");
        } finally {
            this.setState({ busy: false });
        }
    };

    // ✅ Function to show a popup with AR link & QR code
    showPopup = (arLink: string, qrCodeUrl: string) => {
        const popup = document.createElement('div');
        popup.style.position = 'fixed';
        popup.style.top = '50%';
        popup.style.left = '50%';
        popup.style.transform = 'translate(-50%, -50%)';
        popup.style.backgroundColor = 'white';
        popup.style.padding = '20px';
        popup.style.border = '1px solid #ccc';
        popup.style.zIndex = '9999';

        popup.innerHTML = `
            <p><strong>Export Complete!</strong></p>
            <p>Click the link below or scan the QR code to view your model in AR:</p>
            <p><a href="${arLink}" target="_blank">${arLink}</a></p>
            <img src="${qrCodeUrl}" alt="QR Code" style="width: 200px; height: 200px;">
            <br><br>
            <button onclick="document.body.removeChild(this.parentNode)">Close</button>
        `;

        document.body.appendChild(popup);
    };
}

// ✅ Helper function to convert Blob to Base64
async function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64data = reader.result?.toString().split(',')[1];
            resolve(base64data || '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
