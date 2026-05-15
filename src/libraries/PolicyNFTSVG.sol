// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title  PolicyNFTSVG
 * @notice Pure library — generates on-chain SVG + JSON metadata for PolicyNFT.
 * @dev    Zero state, zero external calls, zero reentrancy surface.
 *         Refactored using block scoping {} to prevent "Stack too deep" errors during coverage.
 */
library PolicyNFTSVG {
    using Strings for uint256;
    using Strings for address;

    // -------------------------------------------------------
    //  Types
    // -------------------------------------------------------

    struct SVGParams {
        uint256 tokenId;
        address protocol;
        uint256 coverageAmount; // USDC 6 decimals
        uint256 expiresAt;      // unix timestamp
        uint8   status;         // 0=ACTIVE 1=EXPIRED 2=CLAIMED 3=CANCELLED
    }

    // -------------------------------------------------------
    //  Constants — SVG color palette
    // -------------------------------------------------------

    string private constant _STATUS_ACTIVE    = "ACTIVE";
    string private constant _STATUS_EXPIRED   = "EXPIRED";
    string private constant _STATUS_CLAIMED   = "CLAIMED";
    string private constant _STATUS_CANCELLED = "CANCELLED";

    string private constant _COLOR_ACTIVE    = "#22c55e"; // green
    string private constant _COLOR_EXPIRED   = "#6b7280"; // grey
    string private constant _COLOR_CLAIMED   = "#3b82f6"; // blue
    string private constant _COLOR_CANCELLED = "#ef4444"; // red

    string private constant _BG_COLOR   = "#0f172a";
    string private constant _CARD_COLOR = "#1e293b";
    string private constant _TEXT_COLOR = "#f1f5f9";
    string private constant _DIM_COLOR  = "#94a3b8";

    // -------------------------------------------------------
    //  External — Metadata
    // -------------------------------------------------------

    /**
     * @notice Build the full base64-encoded tokenURI JSON string.
     * @param p SVGParams struct with all policy data.
     * @return  data URI string ready for tokenURI() return.
     */
    function buildTokenURI(SVGParams memory p)
        internal
        pure
        returns (string memory)
    {
        string memory b64Img = Base64.encode(bytes(_buildSVG(p)));
        string memory attributes;
        
        // Block scoping to prevent stack too deep
        {
            attributes = string(abi.encodePacked(
                '"attributes":[',
                    '{"trait_type":"Protocol","value":"', _shortAddress(p.protocol), '"},',
                    '{"trait_type":"Coverage (USDC)","value":"', _formatUsdc(p.coverageAmount), '"},',
                    '{"trait_type":"Expires At","value":"', p.expiresAt.toString(), '"},',
                    '{"trait_type":"Status","value":"', _statusString(p.status), '"}',
                '],'
            ));
        }

        string memory json;
        {
            json = string(abi.encodePacked(
                '{"name":"SentinelShield Policy #', p.tokenId.toString(), '",',
                '"description":"A non-transferable insurance policy issued by SentinelShield Protocol.",',
                attributes,
                '"image":"data:image/svg+xml;base64,', b64Img, '"}'
            ));
        }

        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        ));
    }

    // -------------------------------------------------------
    //  Internal — SVG Builder
    // -------------------------------------------------------

    function _buildSVG(SVGParams memory p)
        private
        pure
        returns (string memory)
    {
        string memory part1;
        string memory part2;
        string memory part3;

        // Part 1: Background & Header
        {
            part1 = string(abi.encodePacked(
                _svgHeader(),
                _svgBackground(),
                _svgShieldIcon(),
                _svgTitle(),
                _svgPolicyId(p.tokenId.toString()),
                _svgRow(68,  "Protocol", _shortAddress(p.protocol), _DIM_COLOR, _TEXT_COLOR)
            ));
        }

        // Part 2: Dynamic Data Rows
        {
            string memory coverageStr = string(abi.encodePacked("$", _formatUsdc(p.coverageAmount), " USDC"));
            part2 = string(abi.encodePacked(
                _svgRow(88,  "Coverage", coverageStr, _DIM_COLOR, _TEXT_COLOR),
                _svgRow(108, "Expires",  _formatTimestamp(p.expiresAt), _DIM_COLOR, _TEXT_COLOR)
            ));
        }

        // Part 3: Footer & Status
        {
            part3 = string(abi.encodePacked(
                _svgStatusBadge(_statusString(p.status), _statusColor(p.status)),
                _svgFooter(),
                "</svg>"
            ));
        }

        // Final Concatenation
        return string(abi.encodePacked(part1, part2, part3));
    }

    // -------------------------------------------------------
    //  SVG Fragments
    // -------------------------------------------------------

    function _svgHeader() private pure returns (string memory) {
        return string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 180" ',
            'width="300" height="180" font-family="monospace">'
        ));
    }

    function _svgBackground() private pure returns (string memory) {
        return string(abi.encodePacked(
            '<rect width="300" height="180" rx="12" fill="', _BG_COLOR, '"/>',
            '<rect x="10" y="10" width="280" height="160" rx="8" fill="', _CARD_COLOR, '" ',
            'stroke="#334155" stroke-width="1"/>'
        ));
    }

    function _svgShieldIcon() private pure returns (string memory) {
        return string(abi.encodePacked(
            '<path d="M24 20 L34 24 L34 32 Q34 38 24 42 Q14 38 14 32 L14 24 Z" ',
            'fill="#6366f1" stroke="#818cf8" stroke-width="1"/>'
        ));
    }

    function _svgTitle() private pure returns (string memory) {
        return string(abi.encodePacked(
            '<text x="44" y="28" font-size="9" fill="#818cf8" font-weight="bold" ',
            'letter-spacing="2">SENTINELSHIELD</text>',
            '<text x="44" y="39" font-size="6" fill="', _DIM_COLOR, '">',
            'DECENTRALIZED INSURANCE PROTOCOL</text>',
            '<line x1="14" y1="48" x2="286" y2="48" stroke="#334155" stroke-width="0.5"/>'
        ));
    }

    function _svgPolicyId(string memory tokenId) private pure returns (string memory) {
        return string(abi.encodePacked(
            '<text x="14" y="62" font-size="7" fill="', _DIM_COLOR, '">POLICY</text>',
            '<text x="60" y="62" font-size="7" fill="', _TEXT_COLOR, '" font-weight="bold">',
            '#', tokenId, '</text>'
        ));
    }

    function _svgRow(
        uint256 y,
        string memory label,
        string memory value,
        string memory labelColor,
        string memory valueColor
    ) private pure returns (string memory) {
        return string(abi.encodePacked(
            '<text x="14" y="', y.toString(), '" font-size="7" fill="', labelColor, '">',
            label, '</text>',
            '<text x="80" y="', y.toString(), '" font-size="7" fill="', valueColor, '">',
            value, '</text>'
        ));
    }

    function _svgStatusBadge(
        string memory label,
        string memory color
    ) private pure returns (string memory) {
        return string(abi.encodePacked(
            '<rect x="14" y="120" width="60" height="14" rx="4" fill="',
            color, '" opacity="0.15"/>',
            '<circle cx="22" cy="127" r="3" fill="', color, '"/>',
            '<text x="28" y="130" font-size="7" fill="', color, '" font-weight="bold">',
            label, '</text>'
        ));
    }

    function _svgFooter() private pure returns (string memory) {
        return string(abi.encodePacked(
            '<line x1="14" y1="145" x2="286" y2="145" stroke="#334155" stroke-width="0.5"/>',
            '<text x="14" y="155" font-size="5" fill="', _DIM_COLOR, '">',
            'Soulbound Token (ERC-5484) | Non-Transferable</text>',
            '<text x="14" y="163" font-size="5" fill="', _DIM_COLOR, '">',
            'sentinelshield.finance</text>'
        ));
    }

    // -------------------------------------------------------
    //  Pure Helpers
    // -------------------------------------------------------

    function _statusString(uint8 status) private pure returns (string memory) {
        if (status == 0) return _STATUS_ACTIVE;
        if (status == 1) return _STATUS_EXPIRED;
        if (status == 2) return _STATUS_CLAIMED;
        return _STATUS_CANCELLED;
    }

    function _statusColor(uint8 status) private pure returns (string memory) {
        if (status == 0) return _COLOR_ACTIVE;
        if (status == 1) return _COLOR_EXPIRED;
        if (status == 2) return _COLOR_CLAIMED;
        return _COLOR_CANCELLED;
    }

    function _formatUsdc(uint256 amount) private pure returns (string memory) {
        uint256 whole   = amount / 1e6;
        uint256 decimal = (amount % 1e6) / 1e4; // 2 decimal places
        return string(abi.encodePacked(
            whole.toString(), ".", decimal < 10 ? "0" : "", decimal.toString()
        ));
    }

    function _shortAddress(address addr) private pure returns (string memory) {
        string memory full = Strings.toHexString(uint160(addr), 20);
        
        bytes memory b = bytes(full);
        bytes memory result = new bytes(13);
        for (uint256 i = 0; i < 6; i++) result[i] = b[i];
        result[6] = "."; result[7] = "."; result[8] = ".";
        result[9]  = b[b.length - 4];
        result[10] = b[b.length - 3];
        result[11] = b[b.length - 2];
        result[12] = b[b.length - 1];
        return string(result);
    }

    function _formatTimestamp(uint256 ts) private pure returns (string memory) {
       
        uint256 day  = ts / 86400;
        uint256 year = 1970;

        while (true) {
            uint256 daysInYear = _isLeap(year) ? 366 : 365;
            if (day < daysInYear) break;
            day -= daysInYear;
            unchecked { ++year; }
        }

        uint8[12] memory monthDays = _monthDays(_isLeap(year));
        uint256 month = 1;
        while (month <= 12 && day >= monthDays[month - 1]) {
            day -= monthDays[month - 1];
            unchecked { ++month; }
        }

        return string(abi.encodePacked(
            year.toString(), "-",
            month < 10 ? "0" : "", month.toString(), "-",
            (day + 1) < 10 ? "0" : "", (day + 1).toString()
        ));
    }

    function _isLeap(uint256 year) private pure returns (bool) {
        return (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    }

    function _monthDays(bool leap) private pure returns (uint8[12] memory) {
        return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    }
}