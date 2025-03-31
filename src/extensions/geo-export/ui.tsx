/**
 * Copyright (c) 2021 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Sukolsak Sakshuwong <sukolsak@stanford.edu>
 * Modified for AR Export by Brian Gadd with help from ChatGPT
 */
import { merge } from 'rxjs';
import { CollapsableControls, CollapsableState } from '../../mol-plugin-ui/base';
import { Button } from '../../mol-plugin-ui/controls/common';
import { GetAppSvg, CubeSendSvg } from '../../mol-plugin-ui/controls/icons'; // Removed CubeScanSvg
import { ParameterControls } from '../../mol-plugin-ui/controls/parameters';
import { download } from '../../mol-util/download';
import { GeometryParams, GeometryControls } from './controls';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';

interface State {
    busy?: boolean;
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
            {/*
            {this.isARSupported && ctrl.behaviors.params.value.format === 'usdz' &&
                <Button icon={CubeScanSvg}
                    onClick={this.viewInAR} style={{ marginTop: 1 }}
                    disabled={this.state.busy || !this.plugin.canvas3d?.reprCount.value}>
                    View in AR
                </Button>
            }
            */}
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

            const timestamp = Date.now();
            const uniqueId = uuidv4().slice(0, 6);
            const baseName = `model-${timestamp}-${uniqueId}`;

            // Export GLB
            this.controls.behaviors.params.next({ ...this.controls.behaviors.params.value, format: 'glb' });
            const glbData = await this.controls.exportGeometry();

            // Export USDZ
            this.controls.behaviors.params.next({ ...this.controls.behaviors.params.value, format: 'usdz' });
            const usdzData = await this.controls.exportGeometry();

            // Get token from Render server
            const tokenRes = await fetch('https://molstar-uploader.onrender.com/token');
            const { token } = await tokenRes.json();

            await uploadFileToGitHub(`${baseName}.glb`, glbData.blob, token);
            await uploadFileToGitHub(`${baseName}.usdz`, usdzData.blob, token);

            const viewUrl = `https://gaddb.github.io/protein-ar-viewer/view.html?model=${baseName}`;
            const qrCode = await QRCode.toDataURL(viewUrl);

            const w = window.open('', '_blank');
            if (w) {
                w.document.write(`<h2>Scan to View in AR</h2><p><a href="${viewUrl}" target="_blank">${viewUrl}</a></p><img src="${qrCode}" alt="QR Code">`);
            }

        } catch (e) {
            console.error(e);
            alert(`AR export failed: ${e}`);
        } finally {
            this.setState({ busy: false });
        }
    };
}

// Moved out of class to avoid stack overflow
async function uploadFileToGitHub(filename: string, blob: Blob, token: string) {
    const content = await blob.arrayBuffer();
    const base64Content = btoa(String.fromCharCode(...new Uint8Array(content)));

    const res = await fetch(`https://api.github.com/repos/gaddb/protein-ar-viewer/contents/models/${filename}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github+json'
        },
        body: JSON.stringify({
            message: `Add ${filename} via Mol* AR exporter`,
            content: base64Content
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Upload failed: ${res.status}\n${text}`);
    }
}

