/**
 * Copyright (c) 2021 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Sukolsak Sakshuwong <sukolsak@stanford.edu>
 * @modified ChatGPT (2025) - Added Export to AR functionality with token proxy.
 */

import { merge } from 'rxjs';
import { CollapsableControls, CollapsableState } from '../../mol-plugin-ui/base';
import { Button } from '../../mol-plugin-ui/controls/common';
import { GetAppSvg, CubeScanSvg, CubeSendSvg } from '../../mol-plugin-ui/controls/icons';
import { ParameterControls } from '../../mol-plugin-ui/controls/parameters';
import { download } from '../../mol-util/download';
import { GeometryParams, GeometryControls } from './controls';
import QRCode from 'qrcode';

// ✅ Update with your Render server URL
const TOKEN_PROXY_URL = "https://molstar-uploader.onrender.com/token";
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

            const data = await this.controls.exportGeometry();
            const pdbId = this.plugin.managers.structure.hierarchy.current.structures[0]?.cell.obj?.data?.model?.entryId || 'Unknown';

            // ✅ Generate a unique filename with timestamp & random string
            const timestamp = new Date().toISOString().replace(/[:.-]/g, '');
            const randomId = Math.random().toString(36).substring(2, 8);
            const glbFilename = `${pdbId}-${timestamp}-${randomId}.glb`;
            const usdzFilename = `${pdbId}-${timestamp}-${randomId}.usdz`;

            console.log("🔄 Generating GLB model...");
            const glbBlob = await data.blob;
            const glbBase64 = await blobToBase64(glbBlob);

            console.log("🔄 Generating USDZ model...");
            const usdzBlob = await data.blob;  // Use the same blob unless separated
            const usdzBase64 = await blobToBase64(usdzBlob);

            console.log("⬆️ Requesting GitHub Token...");
            const tokenResponse = await fetch(TOKEN_PROXY_URL);
            if (!tokenResponse.ok) throw new Error('Failed to retrieve GitHub token.');
            const { token } = await tokenResponse.json();

            console.log("⬆️ Uploading Model via Proxy Service...");
            const uploadResponse = await fetch(UPLOAD_PROXY_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ pdbId, glb: glbBase64, usdz: usdzBase64 })
            });

            const result = await uploadResponse.json();
            if (result.success) {
                console.log("✅ Upload successful:", result.arLink);
                alert("Model uploaded! Scan the QR code or click the link to view in AR.");
                window.open(result.arLink, "_blank");
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
