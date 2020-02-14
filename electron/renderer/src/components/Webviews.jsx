/*
 * Wire
 * Copyright (C) 2018 Wire Swiss GmbH
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see http://www.gnu.org/licenses/.
 *
 */

import './Webviews.css';

import React, {Component} from 'react';

import Webview from './Webview';
import {EVENT_TYPE} from '../../../src/lib/eventType';
import {WindowUrl} from '../../../src/window/WindowUrl';

export default class Webviews extends Component {
  constructor(props) {
    super(props);
    this.state = {
      canDelete: this._getCanDeletes(props.accounts),
    };
  }

  componentWillReceiveProps(nextProps) {
    this.setState({canDelete: this._getCanDeletes(nextProps.accounts)});
  }

  shouldComponentUpdate(nextProps, nextState) {
    for (const nextAccountState of nextProps.accounts) {
      const previousAccountState = this.props.accounts.find(_account => nextAccountState.id === _account.id);
      if (!previousAccountState) {
        return true;
      }
      // If a SSO code is set on a window, use it
      const shouldRedirectToSSOLogin =
        nextAccountState.isAdding && previousAccountState.ssoCode !== nextAccountState.ssoCode;
      const shouldUseCustomWebappUrl =
        !!nextAccountState.webappUrl && previousAccountState.webappUrl !== nextAccountState.webappUrl;

      if (shouldRedirectToSSOLogin || shouldUseCustomWebappUrl) {
        document
          .querySelector(`Webview[data-accountid="${nextAccountState.id}"]`)
          .loadURL(this._getEnvironmentUrl(nextAccountState));
      }

      if (previousAccountState.visible !== nextAccountState.visible) {
        return true;
      }
    }
    return JSON.stringify(nextState.canDelete) !== JSON.stringify(this.state.canDelete);
  }

  _getCanDeletes = accounts => {
    return accounts.reduce(
      (accumulator, account) => ({
        ...accumulator,
        [account.id]: this._canDeleteWebview(account),
      }),
      {},
    );
  };

  _getEnvironmentUrl(account) {
    const currentLocation = new URL(window.location.href);
    const envParam = account.webappUrl || currentLocation.searchParams.get('env');
    const decodedEnvParam = decodeURIComponent(envParam);
    const url = new URL(decodedEnvParam);

    // pass account id to webview so we can access it in the preload script
    url.searchParams.set('id', account.id);

    if (account.ssoCode && account.isAdding) {
      url.pathname = '/auth';
      url.hash = `#sso/${account.ssoCode}`;
    }

    return url.href;
  }

  _accumulateBadgeCount(accounts) {
    return accounts.reduce((accumulated, account) => accumulated + account.badgeCount, 0);
  }

  _onUnreadCountUpdated = (accountId, unreadCount) => {
    this.props.updateAccountBadgeCount(accountId, unreadCount);
    const accumulatedCount = this._accumulateBadgeCount(this.props.accounts);
    window.sendBadgeCount(accumulatedCount);
  };

  _onIpcMessage = (account, {channel, args}) => {
    switch (channel) {
      case EVENT_TYPE.WRAPPER.NAVIGATE_WEBVIEW: {
        const [customUrl] = args;
        const accountId = account.id;
        const updatedWebapp = WindowUrl.createWebappUrl(window.location, customUrl);
        this.props.updateAccountData(accountId, {
          webappUrl: decodeURIComponent(updatedWebapp),
        });
        break;
      }

      case EVENT_TYPE.ACCOUNT.UPDATE_INFO: {
        const [accountData] = args;
        this.props.updateAccountData(account.id, accountData);
        break;
      }

      case EVENT_TYPE.ACTION.NOTIFICATION_CLICK: {
        this.props.switchAccount(account.id);
        break;
      }

      case EVENT_TYPE.LIFECYCLE.SIGNED_IN:
      case EVENT_TYPE.LIFECYCLE.SIGN_OUT: {
        this.props.updateAccountLifecycle(account.id, channel);
        break;
      }

      case EVENT_TYPE.LIFECYCLE.SIGNED_OUT: {
        const [clearData] = args;
        if (clearData) {
          this._deleteWebview(account);
        } else {
          this.props.resetIdentity(account.id);
        }
        break;
      }

      case EVENT_TYPE.LIFECYCLE.UNREAD_COUNT: {
        const [badgeCount] = args;
        this._onUnreadCountUpdated(account.id, badgeCount);
        break;
      }
    }

    this.setState({canDelete: {...this.state.canDelete, [account.id]: this._canDeleteWebview(account)}});
  };

  _onWebviewClose = account => {
    this._deleteWebview(account);
  };

  _deleteWebview = account => {
    window.sendDeleteAccount(account.id, account.sessionID).then(() => {
      this.props.abortAccountCreation(account.id);
    });
  };

  _canDeleteWebview(account) {
    const match = this.props.accounts.find(_account => account.id === _account.id);
    return !match || (!match.userID && !!match.sessionID);
  }

  render() {
    return (
      <ul className="Webviews">
        {this.props.accounts.map((account, index) => (
          <div className="Webviews-container" key={account.id}>
            <Webview
              className={`Webview${account.visible ? '' : ' hide'}`}
              data-accountid={account.id}
              visible={account.visible}
              src={this._getEnvironmentUrl(account)}
              partition={account.sessionID}
              onIpcMessage={event => this._onIpcMessage(account, event)}
              webpreferences="backgroundThrottling=false"
            />
            {this.state.canDelete[account.id] && account.visible && (
              <div className="Webviews-close" onClick={() => this._onWebviewClose(account)}>
                <svg width="16" height="16" viewBox="0 0 16 16">
                  <path
                    d="M2.757 14.657L8 9.414l5.243 5.243 1.414-1.414L9.414 8l5.243-5.243-1.414-1.414L8 6.586 2.757 1.343 1.343 2.757 6.586 8l-5.243 5.243"
                    fillRule="evenodd"
                  />
                </svg>
              </div>
            )}
          </div>
        ))}
      </ul>
    );
  }
}
